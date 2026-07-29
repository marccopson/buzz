import 'package:buzz/features/cos_user_context/cos_user_context.dart';
import 'package:buzz/shared/relay/nostr_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const assignee = 'a';
  const bridge = 'b';

  NostrEvent event({
    String id = 'event-1',
    int createdAt = 1,
    String pubkey = bridge,
    String modules =
        '["today","my_actions","messages","agents","running_order"]',
  }) => NostrEvent(
    id: id,
    pubkey: pubkey,
    createdAt: createdAt,
    kind: EventKind.cosUserContext,
    tags: const [
      ['h', 'mac'],
      ['p', assignee],
      ['d', 'context:$assignee'],
    ],
    content:
        '{"schema":"mac-workspace/cos-user-context/v1","modules":$modules}',
    sig: 'sig',
  );

  test('requires both technical modules for Control Room', () {
    final context = parseCosUserContext(event(), expectedAssignee: assignee);
    expect(context.canUseControlRoom, isTrue);
  });

  test('fails closed for an untrusted or incomplete projection', () {
    expect(
      selectLatestCosUserContext(
        [event(pubkey: 'attacker')],
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
  });

  test('selects the newest trusted projection deterministically', () {
    final selected = selectLatestCosUserContext(
      [event(id: 'older', createdAt: 1), event(id: 'newer', createdAt: 2)],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
    );
    expect(selected?.eventId, 'newer');
  });
}
