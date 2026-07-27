enum CosRunningOrderState {
  blocked,
  humanTest,
  running,
  ready,
  queued,
  completed,
}

class CosRunningOrderCounts {
  final int blocked;
  final int completed;
  final int humanTest;
  final int queued;
  final int ready;
  final int running;

  const CosRunningOrderCounts({
    required this.blocked,
    required this.completed,
    required this.humanTest,
    required this.queued,
    required this.ready,
    required this.running,
  });

  factory CosRunningOrderCounts.fromJson(Map<String, dynamic> json) {
    return CosRunningOrderCounts(
      blocked: _integer(json['blocked']),
      completed: _integer(json['completed']),
      humanTest: _integer(json['human_test']),
      queued: _integer(json['queued']),
      ready: _integer(json['ready']),
      running: _integer(json['running']),
    );
  }
}

class CosRunningOrderItem {
  final String key;
  final String summary;
  final String jiraStatus;
  final String priority;
  final CosRunningOrderState state;
  final List<String> blockers;
  final bool stagingEvidenced;

  const CosRunningOrderItem({
    required this.key,
    required this.summary,
    required this.jiraStatus,
    required this.priority,
    required this.state,
    required this.blockers,
    required this.stagingEvidenced,
  });

  factory CosRunningOrderItem.fromJson(Map<String, dynamic> json) {
    return CosRunningOrderItem(
      key: _text(json['key']),
      summary: _text(json['summary']),
      jiraStatus: _text(json['jira_status']),
      priority: _text(json['priority']),
      state: _state(json['state']),
      blockers: _strings(json['blockers']),
      stagingEvidenced: json['staging_evidenced'] == true,
    );
  }
}

class CosRunningOrderSnapshot {
  final DateTime? generatedAt;
  final String operationalStatus;
  final String overallStatus;
  final String? stagingRevision;
  final CosRunningOrderCounts counts;
  final List<CosRunningOrderItem> items;

  const CosRunningOrderSnapshot({
    required this.generatedAt,
    required this.operationalStatus,
    required this.overallStatus,
    required this.stagingRevision,
    required this.counts,
    required this.items,
  });

  factory CosRunningOrderSnapshot.fromJson(Map<String, dynamic> json) {
    if (json['schema'] != 'mac-workspace/cos-running-order/v1') {
      throw const FormatException('Unsupported COS running-order snapshot');
    }
    return CosRunningOrderSnapshot(
      generatedAt: DateTime.tryParse(_text(json['generated_at_utc'])),
      operationalStatus: _text(json['operational_status']),
      overallStatus: _text(json['overall_status']),
      stagingRevision: _text(json['staging_revision']).isEmpty
          ? null
          : _text(json['staging_revision']),
      counts: CosRunningOrderCounts.fromJson(_map(json['counts'])),
      items: _maps(json['items'])
          .map(CosRunningOrderItem.fromJson)
          .where((item) => item.key.isNotEmpty)
          .toList(),
    );
  }
}

Uri cosRunningOrderUri(String relayUrl) {
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
    path: '/api/cos-running-order/v1',
    query: null,
    fragment: null,
  );
}

Map<String, dynamic> _map(dynamic value) {
  return value is Map ? Map<String, dynamic>.from(value) : {};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  return value is List ? value.map(_map).toList() : [];
}

List<String> _strings(dynamic value) {
  return value is List ? value.whereType<String>().toList() : [];
}

String _text(dynamic value) => value is String ? value : '';

int _integer(dynamic value) => value is int ? value : 0;

CosRunningOrderState _state(dynamic value) {
  return switch (value) {
    'blocked' => CosRunningOrderState.blocked,
    'human-test' => CosRunningOrderState.humanTest,
    'running' => CosRunningOrderState.running,
    'ready' => CosRunningOrderState.ready,
    'queued' => CosRunningOrderState.queued,
    'completed' => CosRunningOrderState.completed,
    _ => throw const FormatException('Unsupported COS running-order state'),
  };
}
