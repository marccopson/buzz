import 'package:buzz/features/control_room/agent_health.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> snapshot({String sourceStatus = 'fresh'}) {
  final dimensions = {
    for (final name in [
      'alive',
      'connected',
      'authenticated',
      'capable',
      'working',
      'fresh',
      'safe',
      'recoverable',
    ])
      name: {
        'state': name == 'working' ? 'unknown' : 'pass',
        'evidence': [name],
      },
  };
  return {
    'schemaVersion': 'mac-agent-health/v1',
    'generatedAt': '2026-07-29T06:00:00Z',
    'authority': {
      'id': 'brain-vps-health-check',
      'role': 'authoritative-estate-observer',
    },
    'operationalStatus': 'green',
    'assuranceStatus': 'partial',
    'assuranceGaps': ['current-run evidence'],
    'source': {
      'status': sourceStatus,
      'maxAgeSeconds': 93600,
      'estate': {
        'path': '/root/MAC-Local/reports/infra-check-latest.md',
        'observedAt': '2026-07-29T06:00:00Z',
        'ageSeconds': 10,
        'sha256': 'a' * 64,
      },
      'agents': {
        'path': '/root/MAC-Local/reports/mac-workspace-hermes-latest.md',
        'observedAt': '2026-07-29T06:00:00Z',
        'ageSeconds': 10,
        'sha256': 'b' * 64,
      },
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
        'dimensions': dimensions,
      },
    ],
    'components': <Object>[],
    'issues': <Object>[],
  };
}

void main() {
  test('parses operational and assurance state separately', () {
    final parsed = AgentHealthSnapshot.fromJson(snapshot());

    expect(parsed.operationalStatus, HealthStatus.green);
    expect(parsed.assuranceStatus, AssuranceStatus.partial);
    expect(
      parsed.agents.single.dimensions['working']?.state,
      HealthDimensionState.unknown,
    );
  });

  test('rejects malformed required contract fields', () {
    final malformed = snapshot();
    malformed['source'] = {'status': 'fresh'};
    expect(
      () => AgentHealthSnapshot.fromJson(malformed),
      throwsA(isA<FormatException>()),
    );
  });

  test('retains stale and invalid source state for fail-closed display', () {
    expect(
      AgentHealthSnapshot.fromJson(
        snapshot(sourceStatus: 'stale'),
      ).sourceStatus,
      HealthSourceStatus.stale,
    );
    expect(
      AgentHealthSnapshot.fromJson(
        snapshot(sourceStatus: 'invalid'),
      ).sourceStatus,
      HealthSourceStatus.invalid,
    );
  });

  test('derives the tailnet health endpoint from relay configuration', () {
    expect(
      agentHealthUri('wss://forge-do.tailfe35cd.ts.net/').toString(),
      'https://forge-do.tailfe35cd.ts.net/api/mac-agent-health/v1',
    );
  });
}
