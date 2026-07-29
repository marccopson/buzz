enum HealthStatus { green, amber, red }

enum AssuranceStatus { complete, partial, insufficient }

enum HealthDimensionState { pass, warn, fail, unknown }

enum HealthSourceStatus { fresh, stale, invalid }

const _dimensionNames = {
  'alive',
  'connected',
  'authenticated',
  'capable',
  'working',
  'fresh',
  'safe',
  'recoverable',
};

class HealthDimension {
  final HealthDimensionState state;
  final List<String> evidence;

  const HealthDimension({required this.state, required this.evidence});

  factory HealthDimension.fromJson(Map<String, dynamic> json) {
    return HealthDimension(
      state: switch (json['state']) {
        'pass' => HealthDimensionState.pass,
        'warn' => HealthDimensionState.warn,
        'fail' => HealthDimensionState.fail,
        'unknown' => HealthDimensionState.unknown,
        _ => throw const FormatException('Unsupported health dimension state'),
      },
      evidence: _strings(
        json['evidence'],
        'dimension.evidence',
        nonEmpty: true,
      ),
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
    final rawDimensions = _requiredMap(json['dimensions'], 'agent.dimensions');
    if (rawDimensions.keys.toSet().difference(_dimensionNames).isNotEmpty ||
        _dimensionNames.difference(rawDimensions.keys.toSet()).isNotEmpty) {
      throw const FormatException(
        'agent.dimensions must contain all health dimensions',
      );
    }
    return AgentHealthRecord(
      id: _text(json['id'], 'agent.id'),
      name: _text(json['name'], 'agent.name'),
      operationalStatus: _status(json['operationalStatus']),
      assuranceStatus: _assurance(json['assuranceStatus']),
      dimensions: rawDimensions.map(
        (key, value) => MapEntry(
          key,
          HealthDimension.fromJson(
            _requiredMap(value, 'agent.dimensions.$key'),
          ),
        ),
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
      id: _text(json['id'], 'record.id'),
      name: _text(json['name'], 'record.name'),
      status: _status(json['status']),
      detail: _text(json['detail'], 'record.detail'),
    );
  }
}

class AgentHealthSnapshot {
  final DateTime generatedAt;
  final HealthStatus operationalStatus;
  final AssuranceStatus assuranceStatus;
  final List<String> assuranceGaps;
  final HealthSourceStatus sourceStatus;
  final int? sourceMaxAgeSeconds;
  final DateTime? estateObservedAt;
  final DateTime? agentsObservedAt;
  final List<HealthRecord> nodes;
  final List<AgentHealthRecord> agents;
  final List<HealthRecord> components;
  final List<String> issues;

  const AgentHealthSnapshot({
    required this.generatedAt,
    required this.operationalStatus,
    required this.assuranceStatus,
    required this.assuranceGaps,
    required this.sourceStatus,
    required this.sourceMaxAgeSeconds,
    required this.estateObservedAt,
    required this.agentsObservedAt,
    required this.nodes,
    required this.agents,
    required this.components,
    required this.issues,
  });

  factory AgentHealthSnapshot.fromJson(Map<String, dynamic> json) {
    if (json['schemaVersion'] != 'mac-agent-health/v1') {
      throw const FormatException('Unsupported MAC agent-health snapshot');
    }
    final authority = _requiredMap(json['authority'], 'authority');
    if (authority['id'] != 'brain-vps-health-check' ||
        authority['role'] != 'authoritative-estate-observer') {
      throw const FormatException('Unsupported agent-health authority');
    }
    final source = _requiredMap(json['source'], 'source');
    final claimedSourceStatus = switch (source['status']) {
      'fresh' => HealthSourceStatus.fresh,
      'stale' => HealthSourceStatus.stale,
      'invalid' => HealthSourceStatus.invalid,
      _ => throw const FormatException('Unsupported source status'),
    };
    final hasEvidence = source['estate'] != null && source['agents'] != null;
    int? maxAge;
    if (claimedSourceStatus != HealthSourceStatus.invalid) {
      maxAge = _integer(source['maxAgeSeconds'], 'source.maxAgeSeconds');
      if (maxAge < 60 || !hasEvidence) {
        throw const FormatException(
          'Fresh or stale source evidence is incomplete',
        );
      }
    }
    final estate = source['estate'] == null
        ? null
        : _sourceEvidence(source['estate'], 'source.estate');
    final agents = source['agents'] == null
        ? null
        : _sourceEvidence(source['agents'], 'source.agents');
    final sourceStatus =
        claimedSourceStatus == HealthSourceStatus.fresh &&
            maxAge != null &&
            estate != null &&
            agents != null &&
            (estate.ageSeconds > maxAge || agents.ageSeconds > maxAge)
        ? HealthSourceStatus.stale
        : claimedSourceStatus;
    return AgentHealthSnapshot(
      generatedAt: _timestamp(json['generatedAt'], 'generatedAt'),
      operationalStatus: _status(json['operationalStatus']),
      assuranceStatus: _assurance(json['assuranceStatus']),
      assuranceGaps: _strings(json['assuranceGaps'], 'assuranceGaps'),
      sourceStatus: sourceStatus,
      sourceMaxAgeSeconds: maxAge,
      estateObservedAt: estate?.observedAt,
      agentsObservedAt: agents?.observedAt,
      nodes: _maps(json['nodes'], 'nodes').map(HealthRecord.fromJson).toList(),
      agents: _maps(
        json['agents'],
        'agents',
      ).map(AgentHealthRecord.fromJson).toList(),
      components: _maps(
        json['components'],
        'components',
      ).map(HealthRecord.fromJson).toList(),
      issues: _strings(json['issues'], 'issues'),
    );
  }

  DateTime? get sourceExpiresAt {
    if (sourceStatus != HealthSourceStatus.fresh ||
        sourceMaxAgeSeconds == null ||
        estateObservedAt == null ||
        agentsObservedAt == null) {
      return null;
    }
    final oldestObservation = estateObservedAt!.isBefore(agentsObservedAt!)
        ? estateObservedAt!
        : agentsObservedAt!;
    return oldestObservation.add(Duration(seconds: sourceMaxAgeSeconds!));
  }

  HealthSourceStatus sourceStatusAt(DateTime now) {
    final expiresAt = sourceExpiresAt;
    if (expiresAt != null && !now.toUtc().isBefore(expiresAt)) {
      return HealthSourceStatus.stale;
    }
    return sourceStatus;
  }
}

class _SourceEvidence {
  final DateTime observedAt;
  final int ageSeconds;

  const _SourceEvidence(this.observedAt, this.ageSeconds);
}

_SourceEvidence _sourceEvidence(dynamic value, String label) {
  final evidence = _requiredMap(value, label);
  _text(evidence['path'], '$label.path');
  final observedAt = _timestamp(evidence['observedAt'], '$label.observedAt');
  final ageSeconds = _integer(evidence['ageSeconds'], '$label.ageSeconds');
  if (ageSeconds < 0) {
    throw FormatException('$label.ageSeconds must not be negative');
  }
  final digest = _text(evidence['sha256'], '$label.sha256');
  if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(digest)) {
    throw FormatException('$label.sha256 must be a SHA-256 digest');
  }
  return _SourceEvidence(observedAt, ageSeconds);
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

Map<String, dynamic> _requiredMap(dynamic value, String label) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    throw FormatException('$label must be an object');
  }
  return Map<String, dynamic>.from(value);
}

List<Map<String, dynamic>> _maps(dynamic value, String label) {
  if (value is! List) {
    throw FormatException('$label must be an array');
  }
  return [
    for (var index = 0; index < value.length; index += 1)
      _requiredMap(value[index], '$label[$index]'),
  ];
}

List<String> _strings(dynamic value, String label, {bool nonEmpty = false}) {
  if (value is! List ||
      value.any((item) => item is! String) ||
      (nonEmpty && value.isEmpty)) {
    throw FormatException('$label must be a string array');
  }
  return value.cast<String>();
}

String _text(dynamic value, String label) {
  if (value is! String || value.isEmpty) {
    throw FormatException('$label must be a non-empty string');
  }
  return value;
}

DateTime _timestamp(dynamic value, String label) {
  final parsed = DateTime.tryParse(_text(value, label));
  if (parsed == null) {
    throw FormatException('$label must be a timestamp');
  }
  return parsed;
}

int _integer(dynamic value, String label) {
  if (value is! int) {
    throw FormatException('$label must be an integer');
  }
  return value;
}
