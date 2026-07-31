import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../shared/relay/relay_provider.dart';
import 'cos_running_order.dart';

final cosRunningOrderHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

class CosRunningOrderNotifier extends AsyncNotifier<CosRunningOrderSnapshot> {
  @override
  Future<CosRunningOrderSnapshot> build() {
    ref.watch(relayConfigProvider);
    return _fetch();
  }

  Future<CosRunningOrderSnapshot> _fetch() async {
    final relayUrl = ref.read(relayConfigProvider).baseUrl;
    final response = await ref
        .read(cosRunningOrderHttpClientProvider)
        .get(cosRunningOrderUri(relayUrl))
        .timeout(const Duration(seconds: 10));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Delivery Room is unavailable (${response.statusCode})');
    }
    final payload = jsonDecode(response.body);
    if (payload is! Map) {
      throw const FormatException('Delivery Room must be a JSON object');
    }
    return CosRunningOrderSnapshot.fromJson(Map<String, dynamic>.from(payload));
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }
}

final cosRunningOrderProvider =
    AsyncNotifierProvider<CosRunningOrderNotifier, CosRunningOrderSnapshot>(
      CosRunningOrderNotifier.new,
    );
