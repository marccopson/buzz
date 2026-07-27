import 'package:buzz/features/cos_running_order/cos_running_order.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses the stable Forge running-order contract', () {
    final snapshot = CosRunningOrderSnapshot.fromJson({
      'schema': 'mac-workspace/cos-running-order/v1',
      'generated_at_utc': '2026-07-27T16:08:14Z',
      'operational_status': 'ok',
      'overall_status': 'degraded',
      'staging_revision': '9c351c0ce66071cf2380edcc31e413d176f0b3d2',
      'counts': {
        'blocked': 1,
        'completed': 0,
        'human_test': 0,
        'queued': 1,
        'ready': 0,
        'running': 1,
      },
      'items': [
        {
          'key': 'COS-102',
          'summary': 'Blocked work',
          'jira_status': 'In Progress',
          'priority': 'High',
          'state': 'blocked',
          'blockers': ['PR #22 has failed checks'],
          'admission_signals': ['forge-ready'],
          'pull_requests': [
            {'number': 22, 'state': 'OPEN', 'draft': false},
          ],
          'active_run': null,
          'staging_evidenced': false,
        },
      ],
    });

    expect(snapshot.counts.blocked, 1);
    expect(snapshot.items.single.key, 'COS-102');
    expect(snapshot.items.single.blockers, ['PR #22 has failed checks']);
    expect(snapshot.stagingRevision, startsWith('9c351c0c'));
  });

  test('derives the adapter URL from the active community relay', () {
    expect(
      cosRunningOrderUri('wss://forge-do.tailfe35cd.ts.net/').toString(),
      'https://forge-do.tailfe35cd.ts.net/api/cos-running-order/v1',
    );
    expect(
      cosRunningOrderUri('https://forge-do.tailfe35cd.ts.net/').toString(),
      'https://forge-do.tailfe35cd.ts.net/api/cos-running-order/v1',
    );
  });
}
