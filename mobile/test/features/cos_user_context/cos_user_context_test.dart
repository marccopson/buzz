import 'package:buzz/features/cos_user_context/cos_user_context.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;

void main() {
  const assignee =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bridgeSecret =
      '0101010101010101010101010101010101010101010101010101010101010101';
  const attackerSecret =
      '0202020202020202020202020202020202020202020202020202020202020202';
  final bridge = nostr.Keys(bridgeSecret).public;

  NostrEvent event({
    int createdAt = 1,
    String secretKey = bridgeSecret,
    String modules =
        '["today","my_actions","messages","agents","running_order"]',
  }) {
    final signed = nostr.Event.from(
      kind: EventKind.cosUserContext,
      content:
          '{"schema":"mac-workspace/cos-user-context/v1","modules":$modules}',
      tags: const [
        ['h', 'mac'],
        ['p', assignee],
        ['d', 'context:$assignee'],
      ],
      secretKey: secretKey,
      createdAt: createdAt,
      verify: true,
    );
    return NostrEvent.fromJson(signed.toMap());
  }

  test('requires both technical modules for Control Room', () {
    final context = parseCosUserContext(event(), expectedAssignee: assignee);
    expect(context.canUseControlRoom, isTrue);
  });

  test('fails closed for an untrusted or incomplete projection', () {
    expect(
      selectLatestCosUserContext(
        [event(secretKey: attackerSecret)],
        assigneePubkey: assignee,
        trustedBridgePubkey: bridge,
      ),
      isNull,
    );
    expect(
      () => parseCosUserContext(
        event(modules: '["today","messages"]'),
        expectedAssignee: assignee,
      ),
      throwsFormatException,
    );
    final signed = event();
    expect(
      () => parseCosUserContext(
        NostrEvent(
          id: signed.id,
          pubkey: signed.pubkey,
          createdAt: signed.createdAt,
          kind: signed.kind,
          tags: signed.tags,
          content: '${signed.content} ',
          sig: signed.sig,
        ),
        expectedAssignee: assignee,
      ),
      throwsFormatException,
    );
  });

  test('selects the newest trusted projection deterministically', () {
    final older = event(createdAt: 1);
    final newer = event(createdAt: 2);
    final selected = selectLatestCosUserContext(
      [older, newer],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
    );
    expect(selected?.eventId, newer.id);
  });
}
