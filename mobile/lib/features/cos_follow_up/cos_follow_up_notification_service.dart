import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

abstract interface class CosFollowUpNotificationSink {
  Future<void> show({
    required String id,
    required String title,
    required String body,
  });
}

class PlatformCosFollowUpNotificationSink
    implements CosFollowUpNotificationSink {
  static const _channel = MethodChannel('buzz/cos_follow_up_notifications');

  @override
  Future<void> show({
    required String id,
    required String title,
    required String body,
  }) async {
    await _channel.invokeMethod<void>('show', {
      'id': id,
      'title': title,
      'body': body,
    });
  }
}

final cosFollowUpNotificationSinkProvider =
    Provider<CosFollowUpNotificationSink>(
      (_) => PlatformCosFollowUpNotificationSink(),
    );
