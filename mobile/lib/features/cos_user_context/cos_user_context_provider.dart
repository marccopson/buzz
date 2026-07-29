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
  final events = await ref
      .read(relaySessionProvider.notifier)
      .fetchHistory(
        NostrFilter(
          kinds: const [EventKind.cosUserContext],
          authors: [bridgePubkey],
          tags: {
            '#p': [pubkey],
          },
          limit: 50,
        ),
      );
  return selectLatestCosUserContext(
    events,
    assigneePubkey: pubkey,
    trustedBridgePubkey: bridgePubkey,
  );
});

CosUserContext? currentCosUserContext(AsyncValue<CosUserContext?> result) {
  if (result.isLoading || result.hasError) return null;
  return result.value;
}
