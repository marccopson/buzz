import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/relay/relay.dart';
import '../cos_follow_up/cos_follow_up_authority.dart';
import 'cos_user_context.dart';

final cosUserContextProvider = FutureProvider<CosUserContext?>((ref) async {
  final refresh = Timer(const Duration(minutes: 1), ref.invalidateSelf);
  ref.onDispose(refresh.cancel);
  final pubkey = ref.watch(myPubkeyProvider)?.trim().toLowerCase();
  if (pubkey == null || pubkey.isEmpty) return null;
  final bridgePubkey = await ref.watch(cosFollowUpBridgePubkeyProvider.future);
  if (bridgePubkey == null) return null;
  final relaySelfPubkey = await ref.watch(relaySelfPubkeyProvider.future);
  if (relaySelfPubkey == null) return null;
  final session = ref.read(relaySessionProvider.notifier);
  final candidateEvents = await session.fetchHistory(
    NostrFilter(
      kinds: const [EventKind.cosUserContext],
      authors: [bridgePubkey],
      tags: {
        '#d': ['context:$pubkey'],
        '#p': [pubkey],
      },
      limit: 50,
    ),
  );
  final candidateChannelIds = cosUserContextChannelCandidates(
    candidateEvents,
    assigneePubkey: pubkey,
    trustedBridgePubkey: bridgePubkey,
  );
  if (candidateChannelIds.isEmpty) return null;
  final channelEvidence = await Future.wait([
    session.fetchHistory(
      NostrFilter(
        kinds: const [39000],
        tags: {'#d': candidateChannelIds},
        limit: candidateChannelIds.length,
      ),
    ),
    session.fetchHistory(
      NostrFilter(
        kinds: const [39002],
        tags: {
          '#d': candidateChannelIds,
          '#p': [pubkey],
        },
        limit: candidateChannelIds.length,
      ),
    ),
  ]);
  final channelId = resolveAuthoritativeCosUserContextChannel(
    candidateChannelIds: candidateChannelIds,
    metadataEvents: channelEvidence[0],
    membershipEvents: channelEvidence[1],
    assigneePubkey: pubkey,
    trustedBridgePubkey: bridgePubkey,
    trustedRelayPubkey: relaySelfPubkey,
  );
  if (channelId == null) return null;
  final events = await session.fetchHistory(
    NostrFilter(
      kinds: const [EventKind.cosUserContext],
      authors: [bridgePubkey],
      tags: {
        '#d': ['context:$pubkey'],
        '#h': [channelId],
        '#p': [pubkey],
      },
      limit: 50,
    ),
  );
  return selectLatestCosUserContext(
    events,
    assigneePubkey: pubkey,
    trustedBridgePubkey: bridgePubkey,
    expectedChannelId: channelId,
  );
});

CosUserContext? currentCosUserContext(AsyncValue<CosUserContext?> result) {
  if (result.isLoading || result.hasError) return null;
  return result.value;
}
