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
        'https://forge-do.tailfe35cd.ts.net/api/mac-delivery-room/v1',
      );
      return http.Response(
        jsonEncode({
          'schemaVersion': 'mac-workspace/delivery-room/v1',
          'generatedAt': '2026-07-31T16:08:14Z',
          'readOnly': true,
          'source': {'status': 'fresh'},
          'deliveryRoom': {
            'schemaVersion': 'delivery-room-projection/v1',
            'attention': {
              'needsManager': {
                'workItemIds': ['COS-469'],
              },
              'blockedOrStalled': {
                'workItemIds': ['COS-469'],
              },
            },
            'workItems': [
              {
                'id': 'COS-469',
                'externalReference': {'key': 'COS-469'},
                'title': 'Complete the finance workflow',
                'currentActivity': 'Draft pull request has merge conflicts.',
                'nextAction': 'Resolve the candidate conflicts.',
                'owner': {'label': 'Marc'},
                'stage': 'independent_review',
                'health': 'needs_manager',
              },
              {
                'id': 'COS-588',
                'externalReference': {'key': 'COS-588'},
                'title': 'Awaiting review',
                'currentActivity': 'Terra is reviewing the candidate.',
                'nextAction': 'Record the verdict.',
                'owner': {'label': 'Terra reviewer'},
                'stage': 'independent_review',
                'health': 'on_track',
              },
              {
                'id': 'COS-700',
                'externalReference': {'key': 'COS-700'},
                'title': 'Completed work',
                'currentActivity': 'Verified on staging.',
                'nextAction': '',
                'owner': {'label': 'Hermes'},
                'stage': 'complete',
                'health': 'on_track',
              },
            ],
          },
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

    expect(find.text('Delivery Room'), findsOneWidget);
    expect(find.text('Evidence current'), findsOneWidget);
    expect(find.textContaining('Read-only delivery view'), findsOneWidget);
    expect(find.text('COS-469'), findsOneWidget);
    expect(
      find.text('Draft pull request has merge conflicts.'),
      findsOneWidget,
    );
    expect(find.text('Review'), findsWidgets);
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
