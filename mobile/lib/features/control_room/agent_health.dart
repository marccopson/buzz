enum HealthStatus { green, amber, red }

enum AssuranceStatus { complete, partial, insufficient }

enum HealthDimensionState { pass, fail, unknown }

class HealthDimension {
  final HealthDimensionState state;
  final List<String> evidence;

  const HealthDimension({required this.state, required this.evidence});

  factory HealthDimension.fromJson(Map<String, dynamic> json) {
    return HealthDimension(
      state: switch (json['state']) {
        'pass' => HealthDimensionState.pass,
        'fail' => HealthDimensionState.fail,
        'unknown' => HealthDimensionState.unknown,
        _ => throw const FormatException('Unsupported health dimension state'),
      },
      evidence: _strings(json['evidence']),
    );
  }
}

class AgentHealthRecord {
  final String id;
  final String name;
  final HealthStatus operationalStatus;
  final AssuranceStatus assuranceStatus;
  final Map<String, HealthDimension> dimensions;

  const AgentHealthRecord({
    required this.id,
    required this.name,
    required this.operationalStatus,
    required this.assuranceStatus,
    required this.dimensions,
  });

  factory AgentHealthRecord.fromJson(Map<String, dynamic> json) {
    final rawDimensions = _map(json['dimensions']);
    return AgentHealthRecord(
      id: _text(json['id']),
      name: _text(json['name']),
      operationalStatus: _status(json['operationalStatus']),
      assuranceStatus: _assurance(json['assuranceStatus']),
      dimensions: rawDimensions.map(
        (key, value) => MapEntry(key, HealthDimension.fromJson(_map(value))),
      ),
    );
  }
}

class HealthRecord {
  final String id;
  final String name;
  final HealthStatus status;
  final String detail;

  const HealthRecord({
    required this.id,
    required this.name,
    required this.status,
    required this.detail,
  });

  factory HealthRecord.fromJson(Map<String, dynamic> json) {
    return HealthRecord(
      id: _text(json['id']),
      name: _text(json['name']),
      status: _status(json['status']),
      detail: _text(json['detail']),
    );
  }
}

class AgentHealthSnapshot {
  final DateTime? generatedAt;
  final HealthStatus operationalStatus;
  final AssuranceStatus assuranceStatus;
  final List<String> assuranceGaps;
  final DateTime? estateObservedAt;
  final List<HealthRecord> nodes;
  final List<AgentHealthRecord> agents;
  final List<HealthRecord> components;
  final List<String> issues;

  const AgentHealthSnapshot({
    required this.generatedAt,
    required this.operationalStatus,
    required this.assuranceStatus,
    required this.assuranceGaps,
    required this.estateObservedAt,
    required this.nodes,
    required this.agents,
    required this.components,
    required this.issues,
  });

  factory AgentHealthSnapshot.fromJson(Map<String, dynamic> json) {
    if (json['schemaVersion'] != 'mac-agent-health/v1') {
      throw const FormatException('Unsupported MAC agent-health snapshot');
    }
    final source = _map(json['source']);
    return AgentHealthSnapshot(
      generatedAt: DateTime.tryParse(_text(json['generatedAt'])),
      operationalStatus: _status(json['operationalStatus']),
      assuranceStatus: _assurance(json['assuranceStatus']),
      assuranceGaps: _strings(json['assuranceGaps']),
      estateObservedAt: DateTime.tryParse(
        _text(_map(source['estate'])['observedAt']),
      ),
      nodes: _maps(json['nodes']).map(HealthRecord.fromJson).toList(),
      agents: _maps(json['agents']).map(AgentHealthRecord.fromJson).toList(),
      components: _maps(json['components']).map(HealthRecord.fromJson).toList(),
      issues: _strings(json['issues']),
    );
  }
}

Uri agentHealthUri(String relayUrl) {
  final relay = Uri.parse(relayUrl);
  final scheme = switch (relay.scheme) {
    'wss' => 'https',
    'ws' => 'http',
    'https' => 'https',
    'http' => 'http',
    _ => throw const FormatException('Invalid community relay URL'),
  };
  return relay.replace(
    scheme: scheme,
    path: '/api/mac-agent-health/v1',
    query: null,
    fragment: null,
  );
}

HealthStatus _status(dynamic value) => switch (value) {
  'green' => HealthStatus.green,
  'amber' => HealthStatus.amber,
  'red' => HealthStatus.red,
  _ => throw const FormatException('Unsupported health status'),
};

AssuranceStatus _assurance(dynamic value) => switch (value) {
  'complete' => AssuranceStatus.complete,
  'partial' => AssuranceStatus.partial,
  'insufficient' => AssuranceStatus.insufficient,
  _ => throw const FormatException('Unsupported assurance status'),
};

Map<String, dynamic> _map(dynamic value) {
  return value is Map ? Map<String, dynamic>.from(value) : {};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  return value is List ? value.map(_map).toList() : [];
}

List<String> _strings(dynamic value) {
  if (value is! List || value.any((item) => item is! String)) {
    throw const FormatException('Expected a string array');
  }
  return value.cast<String>();
}

String _text(dynamic value) => value is String ? value : '';
