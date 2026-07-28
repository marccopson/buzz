import 'package:buzz/features/cos_follow_up/cos_follow_up_notification_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('buzz/cos_follow_up_notifications');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  for (final testCase in [
    (wireValue: 'shown', delivery: CosFollowUpNotificationDelivery.shown),
    (wireValue: 'denied', delivery: CosFollowUpNotificationDelivery.denied),
  ]) {
    test('maps ${testCase.wireValue} native acknowledgement', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            expect(call.method, 'show');
            expect(call.arguments, {
              'id': 'event-1',
              'title': 'We need you',
              'body': 'Confirm the evidence',
            });
            return testCase.wireValue;
          });

      final delivery = await PlatformCosFollowUpNotificationSink().show(
        id: 'event-1',
        title: 'We need you',
        body: 'Confirm the evidence',
      );

      expect(delivery, testCase.delivery);
    });
  }

  test('rejects a missing native acknowledgement', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => null);

    await expectLater(
      PlatformCosFollowUpNotificationSink().show(
        id: 'event-1',
        title: 'We need you',
        body: 'Confirm the evidence',
      ),
      throwsA(
        isA<PlatformException>().having(
          (error) => error.code,
          'code',
          'invalid_delivery_status',
        ),
      ),
    );
  });
}
