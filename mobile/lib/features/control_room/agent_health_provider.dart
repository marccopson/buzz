import 'dart:async';
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

enum AgentHealthRefreshStatus { idle, refreshing, failed }

class AgentHealthRefreshStatusNotifier
    extends Notifier<AgentHealthRefreshStatus> {
  @override
  AgentHealthRefreshStatus build() => AgentHealthRefreshStatus.idle;

  void update(AgentHealthRefreshStatus status) => state = status;
}

final agentHealthRefreshStatusProvider =
    NotifierProvider<
      AgentHealthRefreshStatusNotifier,
      AgentHealthRefreshStatus
    >(AgentHealthRefreshStatusNotifier.new);

final agentHealthExpiryClockProvider = StreamProvider.autoDispose
    .family<DateTime, DateTime?>((ref, expiresAt) {
      final now = DateTime.now().toUtc();
      final controller = StreamController<DateTime>();
      controller.add(now);
      Timer? timer;
      if (expiresAt != null && expiresAt.isAfter(now)) {
        timer = Timer(expiresAt.difference(now), () {
          controller.add(expiresAt);
          controller.close();
        });
      } else {
        controller.close();
      }
      ref.onDispose(() {
        timer?.cancel();
        if (!controller.isClosed) controller.close();
      });
      return controller.stream;
    });

class AgentHealthNotifier extends AsyncNotifier<AgentHealthSnapshot> {
  Timer? _poll;

  @override
  Future<AgentHealthSnapshot> build() async {
    ref.watch(relayConfigProvider);
    _poll?.cancel();
    _poll = Timer.periodic(
      const Duration(minutes: 1),
      (_) => unawaited(refresh()),
    );
    ref.onDispose(() => _poll?.cancel());
    final snapshot = await _fetch();
    ref
        .read(agentHealthRefreshStatusProvider.notifier)
        .update(AgentHealthRefreshStatus.idle);
    return snapshot;
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
    final refreshStatus = ref.read(agentHealthRefreshStatusProvider.notifier);
    if (ref.read(agentHealthRefreshStatusProvider) ==
        AgentHealthRefreshStatus.refreshing) {
      return;
    }
    refreshStatus.update(AgentHealthRefreshStatus.refreshing);
    try {
      state = AsyncData(await _fetch());
      refreshStatus.update(AgentHealthRefreshStatus.idle);
    } on Object catch (error, stackTrace) {
      refreshStatus.update(AgentHealthRefreshStatus.failed);
      if (!state.hasValue) {
        state = AsyncError(error, stackTrace);
      }
    }
  }
}

final agentHealthProvider =
    AsyncNotifierProvider<AgentHealthNotifier, AgentHealthSnapshot>(
      AgentHealthNotifier.new,
    );
