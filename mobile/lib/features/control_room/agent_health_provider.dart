import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../shared/relay/relay_provider.dart';
import 'agent_health.dart';

final agentHealthHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

class AgentHealthNotifier extends AsyncNotifier<AgentHealthSnapshot> {
  @override
  Future<AgentHealthSnapshot> build() {
    ref.watch(relayConfigProvider);
    return _fetch();
  }

  Future<AgentHealthSnapshot> _fetch() async {
    final relayUrl = ref.read(relayConfigProvider).baseUrl;
    final response = await ref
        .read(agentHealthHttpClientProvider)
        .get(agentHealthUri(relayUrl))
        .timeout(const Duration(seconds: 10));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Agent health is unavailable (${response.statusCode})');
    }
    final payload = jsonDecode(response.body);
    if (payload is! Map) {
      throw const FormatException('Agent health must be a JSON object');
    }
    return AgentHealthSnapshot.fromJson(Map<String, dynamic>.from(payload));
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }
}

final agentHealthProvider =
    AsyncNotifierProvider<AgentHealthNotifier, AgentHealthSnapshot>(
      AgentHealthNotifier.new,
    );
