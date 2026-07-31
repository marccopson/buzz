enum CosRunningOrderState {
  ready,
  building,
  independentReview,
  stagingVerification,
  completed,
}

class CosRunningOrderCounts {
  final int ready;
  final int building;
  final int independentReview;
  final int stagingVerification;
  final int completed;
  final int needsManager;
  final int blockedOrStalled;

  const CosRunningOrderCounts({
    required this.ready,
    required this.building,
    required this.independentReview,
    required this.stagingVerification,
    required this.completed,
    required this.needsManager,
    required this.blockedOrStalled,
  });
}

class CosRunningOrderItem {
  final String key;
  final String title;
  final String currentActivity;
  final String nextAction;
  final String owner;
  final CosRunningOrderState state;
  final String health;

  const CosRunningOrderItem({
    required this.key,
    required this.title,
    required this.currentActivity,
    required this.nextAction,
    required this.owner,
    required this.state,
    required this.health,
  });

  factory CosRunningOrderItem.fromJson(Map<String, dynamic> json) {
    final reference = _map(json['externalReference']);
    final owner = _map(json['owner']);
    return CosRunningOrderItem(
      key: _text(reference['key']).isEmpty
          ? _text(json['id'])
          : _text(reference['key']),
      title: _text(json['title']),
      currentActivity: _text(json['currentActivity']),
      nextAction: _text(json['nextAction']),
      owner: _text(owner['label']),
      state: _state(json['stage']),
      health: _text(json['health']),
    );
  }
}

class CosRunningOrderSnapshot {
  final DateTime? generatedAt;
  final String sourceStatus;
  final CosRunningOrderCounts counts;
  final List<CosRunningOrderItem> items;

  const CosRunningOrderSnapshot({
    required this.generatedAt,
    required this.sourceStatus,
    required this.counts,
    required this.items,
  });

  factory CosRunningOrderSnapshot.fromJson(Map<String, dynamic> json) {
    if (json['schemaVersion'] != 'mac-workspace/delivery-room/v1' ||
        json['readOnly'] != true) {
      throw const FormatException('Unsupported Delivery Room snapshot');
    }
    final source = _map(json['source']);
    if (source['status'] != 'fresh') {
      throw const FormatException('Delivery Room evidence is not current');
    }
    final room = _map(json['deliveryRoom']);
    if (room['schemaVersion'] != 'delivery-room-projection/v1') {
      throw const FormatException('Unsupported Delivery Room projection');
    }
    final items = _maps(room['workItems'])
        .map(CosRunningOrderItem.fromJson)
        .where((item) => item.key.isNotEmpty)
        .toList();
    int count(CosRunningOrderState state) =>
        items.where((item) => item.state == state).length;
    final attention = _map(room['attention']);
    return CosRunningOrderSnapshot(
      generatedAt: DateTime.tryParse(_text(json['generatedAt'])),
      sourceStatus: _text(source['status']),
      counts: CosRunningOrderCounts(
        ready: count(CosRunningOrderState.ready),
        building: count(CosRunningOrderState.building),
        independentReview: count(CosRunningOrderState.independentReview),
        stagingVerification: count(CosRunningOrderState.stagingVerification),
        completed: count(CosRunningOrderState.completed),
        needsManager: _strings(
          _map(attention['needsManager'])['workItemIds'],
        ).length,
        blockedOrStalled: _strings(
          _map(attention['blockedOrStalled'])['workItemIds'],
        ).length,
      ),
      items: items,
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
    path: '/api/mac-delivery-room/v1',
    query: null,
    fragment: null,
  );
}

Map<String, dynamic> _map(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : {};

List<Map<String, dynamic>> _maps(dynamic value) =>
    value is List ? value.map(_map).toList() : [];

List<String> _strings(dynamic value) =>
    value is List ? value.whereType<String>().toList() : [];

String _text(dynamic value) => value is String ? value : '';

CosRunningOrderState _state(dynamic value) => switch (value) {
  'ready' => CosRunningOrderState.ready,
  'building' => CosRunningOrderState.building,
  'independent_review' => CosRunningOrderState.independentReview,
  'staging_verification' => CosRunningOrderState.stagingVerification,
  'complete' => CosRunningOrderState.completed,
  _ => throw const FormatException('Unsupported Delivery Room stage'),
};
