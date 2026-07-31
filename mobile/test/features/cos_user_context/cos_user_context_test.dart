import 'dart:convert';

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
  const relaySecret =
      '0303030303030303030303030303030303030303030303030303030303030303';
  final bridge = nostr.Keys(bridgeSecret).public;
  final relay = nostr.Keys(relaySecret).public;

  NostrEvent event({
    int createdAt = 1,
    String secretKey = bridgeSecret,
    String channelId = 'mac',
    List<String> modules = const [
      'today',
      'my_actions',
      'messages',
      'agents',
      'running_order',
    ],
    Map<String, Object?>? content,
  }) {
    final signed = nostr.Event.from(
      kind: EventKind.cosUserContext,
      content: jsonEncode(
        content ??
            {
              'schema': 'mac-workspace/cos-user-context/v1',
              'tenant_slug': 'mac-surfacing',
              'user': {
                'id': 42,
                'name': 'Jake Wherton',
                'role': 'managing_director',
                'role_label': 'Managing Director',
              },
              'modules': modules,
              'assistant': modules.contains('assistant')
                  ? {
                      'key': 'mac-assistant',
                      'label': 'MAC Assistant',
                      'execution': 'brain-vps',
                      'memory_scope': 'private-channel',
                    }
                  : null,
              'generated_at': '2026-07-29T09:00:00Z',
            },
      ),
      tags: [
        ['h', channelId],
        const ['p', assignee],
        const ['d', 'context:$assignee'],
      ],
      secretKey: secretKey,
      createdAt: createdAt,
      verify: true,
    );
    return NostrEvent.fromJson(signed.toMap());
  }

  NostrEvent channelState({
    required int kind,
    required String channelId,
    required List<List<String>> tags,
    String secretKey = relaySecret,
    int createdAt = 1,
  }) {
    final signed = nostr.Event.from(
      kind: kind,
      content: '',
      tags: [
        ['d', channelId],
        ...tags,
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

  test('accepts restricted modules and fails closed for untrusted context', () {
    expect(
      selectLatestCosUserContext(
        [event(secretKey: attackerSecret)],
        assigneePubkey: assignee,
        trustedBridgePubkey: bridge,
      ),
      isNull,
    );
    expect(
      parseCosUserContext(
        event(modules: const ['today', 'messages']),
        expectedAssignee: assignee,
      ).hasModule('my_actions'),
      isFalse,
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

  test('fails closed when canonical identity fields are missing', () {
    for (final content in [
      {
        'schema': 'mac-workspace/cos-user-context/v1',
        'modules': ['today', 'my_actions', 'messages'],
      },
      {
        'schema': 'mac-workspace/cos-user-context/v1',
        'tenant_slug': 'MAC Surfacing',
        'user': {
          'id': 42,
          'name': 'Jake Wherton',
          'role': 'managing_director',
          'role_label': 'Managing Director',
        },
        'modules': ['today', 'my_actions', 'messages'],
        'assistant': null,
        'generated_at': '2026-07-29T09:00:00Z',
      },
      {
        'schema': 'mac-workspace/cos-user-context/v1',
        'tenant_slug': 'mac--surfacing',
        'user': {
          'id': 42,
          'name': 'Jake Wherton',
          'role': 'managing_director',
          'role_label': 'Managing Director',
        },
        'modules': ['today', 'messages'],
        'assistant': null,
        'generated_at': '2026-07-29T09:00:00Z',
      },
      {
        'schema': 'mac-workspace/cos-user-context/v1',
        'tenant_slug': 'mac-surfacing',
        'user': {
          'id': null,
          'name': 'Jake Wherton',
          'role': 'managing_director',
          'role_label': 'Managing Director',
        },
        'modules': ['today', 'my_actions', 'messages'],
        'assistant': null,
        'generated_at': '2026-07-29T09:00:00Z',
      },
      {
        'schema': 'mac-workspace/cos-user-context/v1',
        'tenant_slug': 'mac-surfacing',
        'user': {
          'id': 42,
          'name': 'Jake Wherton',
          'role': 'managing_director',
          'role_label': 'Managing Director',
        },
        'modules': ['today', 'my_actions', 'messages'],
        'assistant': null,
        'generated_at': ' ',
      },
    ]) {
      expect(
        () => parseCosUserContext(
          event(content: content),
          expectedAssignee: assignee,
        ),
        throwsFormatException,
      );
    }
  });

  test('enforces the private assistant boundary', () {
    final invalidAssistant = {
      'schema': 'mac-workspace/cos-user-context/v1',
      'tenant_slug': 'mac-surfacing',
      'user': {
        'id': 42,
        'name': 'Jake Wherton',
        'role': 'managing_director',
        'role_label': 'Managing Director',
      },
      'modules': ['today', 'my_actions', 'messages', 'assistant'],
      'assistant': {
        'key': 'mac-assistant',
        'label': 'MAC Assistant',
        'execution': 'on-device',
        'memory_scope': 'shared',
      },
      'generated_at': '2026-07-29T09:00:00Z',
    };
    expect(
      () => parseCosUserContext(
        event(content: invalidAssistant),
        expectedAssignee: assignee,
      ),
      throwsFormatException,
    );
    expect(
      parseCosUserContext(
        event(modules: const ['today', 'my_actions', 'messages', 'assistant']),
        expectedAssignee: assignee,
      ).hasModule('assistant'),
      isTrue,
    );
  });

  test('selects the newest trusted projection deterministically', () {
    final older = event(createdAt: 1);
    final newer = event(createdAt: 2, modules: const ['today', 'messages']);
    final selected = selectLatestCosUserContext(
      [older, newer],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
    );
    expect(selected?.eventId, newer.id);
    expect(selected?.hasModule('my_actions'), isFalse);
  });

  test('binds access to one exact private bridge-owned channel', () {
    const otherChannel = 'other';
    final contexts = [
      event(channelId: 'mac'),
      event(channelId: otherChannel, createdAt: 2),
    ];
    final candidates = cosUserContextChannelCandidates(
      contexts,
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
    );
    expect(candidates, ['mac', otherChannel]);
    final resolved = resolveAuthoritativeCosUserContextChannel(
      candidateChannelIds: candidates,
      metadataEvents: [
        channelState(
          kind: 39000,
          channelId: 'mac',
          tags: const [
            ['private'],
          ],
        ),
        channelState(
          kind: 39000,
          channelId: otherChannel,
          tags: const [
            ['private'],
          ],
        ),
      ],
      membershipEvents: [
        channelState(
          kind: 39002,
          channelId: 'mac',
          tags: [
            ['p', bridge, '', 'owner'],
            const ['p', assignee, '', 'member'],
          ],
        ),
        channelState(
          kind: 39002,
          channelId: otherChannel,
          tags: [
            ['p', bridge, '', 'owner'],
            const ['p', assignee, '', 'member'],
            const ['p', attackerSecret, '', 'member'],
          ],
        ),
      ],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
      trustedRelayPubkey: relay,
    );
    expect(resolved, 'mac');
    expect(
      selectLatestCosUserContext(
        contexts,
        assigneePubkey: assignee,
        trustedBridgePubkey: bridge,
        expectedChannelId: resolved,
      )?.channelId,
      'mac',
    );
  });

  test('fails closed when two channels claim the same identity', () {
    const otherChannel = 'other';
    final resolved = resolveAuthoritativeCosUserContextChannel(
      candidateChannelIds: const ['mac', otherChannel],
      metadataEvents: [
        channelState(
          kind: 39000,
          channelId: 'mac',
          tags: const [
            ['private'],
          ],
        ),
        channelState(
          kind: 39000,
          channelId: otherChannel,
          tags: const [
            ['private'],
          ],
        ),
      ],
      membershipEvents: [
        for (final channel in const ['mac', otherChannel])
          channelState(
            kind: 39002,
            channelId: channel,
            tags: [
              ['p', bridge, '', 'owner'],
              const ['p', assignee, '', 'member'],
            ],
          ),
      ],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
      trustedRelayPubkey: relay,
    );
    expect(resolved, isNull);
    expect(
      () => parseCosUserContext(
        event(channelId: otherChannel),
        expectedAssignee: assignee,
        expectedChannelId: 'mac',
      ),
      throwsFormatException,
    );
  });

  test('a newer membership snapshot revokes an older authorised identity', () {
    final resolved = resolveAuthoritativeCosUserContextChannel(
      candidateChannelIds: const ['mac'],
      metadataEvents: [
        channelState(
          kind: 39000,
          channelId: 'mac',
          tags: const [
            ['private'],
          ],
        ),
      ],
      membershipEvents: [
        channelState(
          kind: 39002,
          channelId: 'mac',
          createdAt: 1,
          tags: [
            ['p', bridge, '', 'owner'],
            const ['p', assignee, '', 'member'],
          ],
        ),
        channelState(
          kind: 39002,
          channelId: 'mac',
          createdAt: 2,
          tags: [
            ['p', bridge, '', 'owner'],
          ],
        ),
      ],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
      trustedRelayPubkey: relay,
    );
    expect(resolved, isNull);
  });

  test('rejects channel authority not signed by the active relay', () {
    final resolved = resolveAuthoritativeCosUserContextChannel(
      candidateChannelIds: const ['mac'],
      metadataEvents: [
        channelState(
          kind: 39000,
          channelId: 'mac',
          tags: const [
            ['private'],
          ],
          secretKey: attackerSecret,
        ),
      ],
      membershipEvents: [
        channelState(
          kind: 39002,
          channelId: 'mac',
          tags: [
            ['p', bridge, '', 'owner'],
            const ['p', assignee, '', 'member'],
          ],
        ),
      ],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
      trustedRelayPubkey: relay,
    );
    expect(resolved, isNull);
  });
}
