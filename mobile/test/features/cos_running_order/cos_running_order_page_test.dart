import 'dart:convert';

import 'package:buzz/features/cos_running_order/cos_running_order_page.dart';
import 'package:buzz/features/cos_running_order/cos_running_order_provider.dart';
import 'package:buzz/features/cos_user_context/cos_user_context.dart';
import 'package:buzz/features/cos_user_context/cos_user_context_provider.dart';
import 'package:buzz/shared/relay/relay_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import '../../helpers/widget_helpers.dart';

void main() {
  const authorisedContext = CosUserContext(
    eventId: 'context',
    channelId: 'channel',
    assigneePubkey: 'user',
    modules: ['today', 'my_actions', 'messages', 'running_order'],
    createdAt: 1,
  );

  testWidgets('shows health, counts and focused delivery items', (
    tester,
  ) async {
    var requests = 0;
    final client = http_testing.MockClient((request) async {
      requests += 1;
      expect(
        request.url.toString(),
        'https://forge-do.tailfe35cd.ts.net/api/cos-running-order/v1',
      );
      return http.Response(
        jsonEncode({
          'schema': 'mac-workspace/cos-running-order/v1',
          'generated_at_utc': '2026-07-27T16:08:14Z',
          'operational_status': 'ok',
          'overall_status': 'degraded',
          'staging_revision': 'a1b2c3d4e5f678901234567890abcdef',
          'counts': {
            'active': 7,
            'agent_running': 1,
            'blocked': 22,
            'completed': 0,
            'human_test': 1,
            'queued': 96,
            'ready': 0,
            'running': 8,
          },
          'items': [
            {
              'key': 'COS-469',
              'summary': 'Complete the finance workflow',
              'jira_status': 'In Progress',
              'priority': 'High',
              'state': 'blocked',
              'blockers': ['Draft pull request has merge conflicts'],
              'staging_evidenced': false,
            },
            {
              'key': 'COS-588',
              'summary': 'Awaiting review in Jira',
              'jira_status': 'In Review',
              'priority': 'Medium',
              'state': 'running',
              'execution_state': 'active',
              'blockers': <String>[],
              'staging_evidenced': false,
            },
            {
              'key': 'COS-700',
              'summary': 'Later queued work',
              'jira_status': 'Backlog',
              'priority': 'Low',
              'state': 'queued',
              'blockers': [],
              'staging_evidenced': false,
            },
          ],
        }),
        200,
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(
            const AsyncData(authorisedContext),
          ),
          relayConfigProvider.overrideWith(
            () =>
                _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
          ),
          cosRunningOrderHttpClientProvider.overrideWithValue(client),
        ],
        child: const CosRunningOrderPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('COS Running Order'), findsOneWidget);
    expect(find.text('Collector healthy'), findsOneWidget);
    expect(find.textContaining('Delivery degraded'), findsOneWidget);
    expect(find.text('COS-469'), findsOneWidget);
    expect(find.text('Draft pull request has merge conflicts'), findsOneWidget);
    expect(find.text('Jira active'), findsWidgets);
    expect(find.text('COS-588'), findsOneWidget);
    expect(find.text('COS-700'), findsNothing);

    final container = ProviderScope.containerOf(
      tester.element(find.text('COS-469')),
    );
    container.updateOverrides([
      cosUserContextProvider.overrideWithValue(const AsyncData(null)),
      relayConfigProvider.overrideWith(
        () => _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
      ),
      cosRunningOrderHttpClientProvider.overrideWithValue(client),
    ]);
    await tester.pumpAndSettle();

    expect(find.text('Access not available'), findsOneWidget);
    expect(find.text('COS-469'), findsNothing);
    expect(requests, 1);
  });

  testWidgets('fails closed before fetching when role access is absent', (
    tester,
  ) async {
    var requests = 0;
    final client = http_testing.MockClient((_) async {
      requests += 1;
      return http.Response('{}', 200);
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          cosUserContextProvider.overrideWithValue(const AsyncData(null)),
          cosRunningOrderHttpClientProvider.overrideWithValue(client),
        ],
        child: const CosRunningOrderPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Access not available'), findsOneWidget);
    expect(requests, 0);
  });
}

class _TestRelayConfigNotifier extends RelayConfigNotifier {
  final String baseUrl;

  _TestRelayConfigNotifier(this.baseUrl);

  @override
  RelayConfig build() => RelayConfig(baseUrl: baseUrl);
}
