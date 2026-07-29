import 'package:buzz/features/control_room/agent_health.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses operational and assurance state separately', () {
    final snapshot = AgentHealthSnapshot.fromJson({
      'schemaVersion': 'mac-agent-health/v1',
      'generatedAt': '2026-07-29T06:00:00Z',
      'operationalStatus': 'green',
      'assuranceStatus': 'partial',
      'assuranceGaps': ['current-run evidence'],
      'source': {
        'status': 'fresh',
        'estate': {'observedAt': '2026-07-29T06:00:00Z'},
      },
      'nodes': [
        {'id': 'brain', 'name': 'Brain', 'status': 'green', 'detail': 'OK'},
      ],
      'agents': [
        {
          'id': 'sammi',
          'name': 'Sammi',
          'operationalStatus': 'green',
          'assuranceStatus': 'partial',
          'dimensions': {
            'working': {
              'state': 'unknown',
              'evidence': ['No run evidence yet'],
            },
          },
        },
      ],
      'components': <Object>[],
      'issues': <Object>[],
    });

    expect(snapshot.operationalStatus, HealthStatus.green);
    expect(snapshot.assuranceStatus, AssuranceStatus.partial);
    expect(
      snapshot.agents.single.dimensions['working']?.state,
      HealthDimensionState.unknown,
    );
  });

  test('derives the tailnet health endpoint from relay configuration', () {
    expect(
      agentHealthUri('wss://forge-do.tailfe35cd.ts.net/').toString(),
      'https://forge-do.tailfe35cd.ts.net/api/mac-agent-health/v1',
    );
  });
}
