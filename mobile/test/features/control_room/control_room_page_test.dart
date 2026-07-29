import 'dart:convert';

import 'package:buzz/features/control_room/agent_health_provider.dart';
import 'package:buzz/features/control_room/control_room_page.dart';
import 'package:buzz/shared/relay/relay_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import '../../helpers/widget_helpers.dart';

void main() {
  testWidgets('shows operational state and assurance gaps separately', (
    tester,
  ) async {
    final client = http_testing.MockClient((request) async {
      expect(
        request.url.toString(),
        'https://forge-do.tailfe35cd.ts.net/api/mac-agent-health/v1',
      );
      return http.Response(
        jsonEncode({
          'schemaVersion': 'mac-agent-health/v1',
          'generatedAt': '2026-07-29T06:00:00Z',
          'operationalStatus': 'green',
          'assuranceStatus': 'partial',
          'assuranceGaps': ['current-run evidence', 'recovery evidence'],
          'source': {
            'status': 'fresh',
            'estate': {'observedAt': '2026-07-29T06:00:00Z'},
          },
          'nodes': [
            {
              'id': 'brain',
              'name': 'Brain',
              'status': 'green',
              'detail': 'Baseline checks OK',
            },
          ],
          'agents': [
            {
              'id': 'sammi',
              'name': 'Sammi',
              'operationalStatus': 'green',
              'assuranceStatus': 'partial',
              'dimensions': {
                'alive': {
                  'state': 'pass',
                  'evidence': ['Gateway active'],
                },
                'working': {
                  'state': 'unknown',
                  'evidence': ['No current-run evidence'],
                },
              },
            },
          ],
          'components': <Object>[],
          'issues': <Object>[],
        }),
        200,
      );
    });
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          relayConfigProvider.overrideWith(
            () =>
                _TestRelayConfigNotifier('https://forge-do.tailfe35cd.ts.net'),
          ),
          agentHealthHttpClientProvider.overrideWithValue(client),
        ],
        child: const ControlRoomPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Control Room'), findsOneWidget);
    expect(find.text('Healthy'), findsWidgets);
    expect(find.text('partial'), findsOneWidget);
    expect(find.text('2 known gap(s)'), findsOneWidget);
    expect(find.text('Sammi'), findsOneWidget);
    expect(find.text('working'), findsOneWidget);
  });
}

class _TestRelayConfigNotifier extends RelayConfigNotifier {
  final String baseUrl;

  _TestRelayConfigNotifier(this.baseUrl);

  @override
  RelayConfig build() => RelayConfig(baseUrl: baseUrl);
}
