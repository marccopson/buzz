import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

enum CosFollowUpNotificationDelivery { shown, denied }

abstract interface class CosFollowUpNotificationSink {
  Future<CosFollowUpNotificationDelivery> show({
    required String id,
    required String title,
    required String body,
  });
}

class PlatformCosFollowUpNotificationSink
    implements CosFollowUpNotificationSink {
  static const _channel = MethodChannel('buzz/cos_follow_up_notifications');

  @override
  Future<CosFollowUpNotificationDelivery> show({
    required String id,
    required String title,
    required String body,
  }) async {
    final status = await _channel.invokeMethod<String>('show', {
      'id': id,
      'title': title,
      'body': body,
    });
    return switch (status) {
      'shown' => CosFollowUpNotificationDelivery.shown,
      'denied' => CosFollowUpNotificationDelivery.denied,
      _ => throw PlatformException(
        code: 'invalid_delivery_status',
        message: 'Native notification delivery returned $status',
      ),
    };
  }
}

final cosFollowUpNotificationSinkProvider =
    Provider<CosFollowUpNotificationSink>(
      (_) => PlatformCosFollowUpNotificationSink(),
    );
