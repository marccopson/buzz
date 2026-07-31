import 'package:buzz/features/cos_running_order/cos_running_order.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses the signed Delivery Room projection contract', () {
    final snapshot = CosRunningOrderSnapshot.fromJson({
      'schemaVersion': 'mac-workspace/delivery-room/v1',
      'generatedAt': '2026-07-31T16:08:14Z',
      'readOnly': true,
      'source': {'status': 'fresh'},
      'deliveryRoom': {
        'schemaVersion': 'delivery-room-projection/v1',
        'attention': {
          'needsManager': {
            'workItemIds': ['COS-102'],
          },
          'blockedOrStalled': {
            'workItemIds': ['COS-102'],
          },
        },
        'workItems': [
          {
            'id': 'work-cos-102',
            'externalReference': {'key': 'COS-102'},
            'title': 'Complete the finance workflow',
            'currentActivity': 'Terra is reviewing the candidate.',
            'nextAction': 'Address the review verdict.',
            'owner': {'label': 'Terra reviewer'},
            'stage': 'independent_review',
            'health': 'needs_manager',
          },
          {
            'id': 'work-cos-103',
            'externalReference': {'key': 'COS-103'},
            'title': 'Verify the staging release',
            'currentActivity': 'Browser smoke is running.',
            'nextAction': 'Record the staging evidence.',
            'owner': {'label': 'Hermes supervisor'},
            'stage': 'staging_verification',
            'health': 'on_track',
          },
        ],
      },
    });

    expect(snapshot.counts.independentReview, 1);
    expect(snapshot.counts.stagingVerification, 1);
    expect(snapshot.counts.needsManager, 1);
    expect(snapshot.items.first.key, 'COS-102');
    expect(snapshot.items.first.state, CosRunningOrderState.independentReview);
    expect(snapshot.sourceStatus, 'fresh');
  });

  test('fails closed for stale Delivery Room evidence', () {
    expect(
      () => CosRunningOrderSnapshot.fromJson({
        'schemaVersion': 'mac-workspace/delivery-room/v1',
        'readOnly': true,
        'source': {'status': 'stale'},
      }),
      throwsFormatException,
    );
  });

  test('derives the Delivery Room URL from the active community relay', () {
    expect(
      cosRunningOrderUri('wss://forge-do.tailfe35cd.ts.net/').toString(),
      'https://forge-do.tailfe35cd.ts.net/api/mac-delivery-room/v1',
    );
    expect(
      cosRunningOrderUri('https://forge-do.tailfe35cd.ts.net/').toString(),
      'https://forge-do.tailfe35cd.ts.net/api/mac-delivery-room/v1',
    );
  });
}
