import 'dart:async';
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../shared/relay/relay_provider.dart';
import '../cos_user_context/cos_user_context_provider.dart';
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
  int _accessGeneration = 0;
  bool _authorised = false;

  @override
  Future<AgentHealthSnapshot> build() async {
    final generation = ++_accessGeneration;
    final workspaceContext = currentCosUserContext(
      ref.watch(cosUserContextProvider),
    );
    ref.watch(relayConfigProvider);
    _poll?.cancel();
    _authorised = workspaceContext?.canUseControlRoom == true;
    if (!_authorised) {
      throw StateError('Control Room access is not available for this role.');
    }
    _poll = Timer.periodic(
      const Duration(minutes: 1),
      (_) => unawaited(refresh()),
    );
    ref.onDispose(() {
      _authorised = false;
      _accessGeneration++;
      _poll?.cancel();
    });
    final snapshot = await _fetch();
    if (!_authorised || generation != _accessGeneration) {
      throw StateError('Control Room access changed during refresh.');
    }
    ref
        .read(agentHealthRefreshStatusProvider.notifier)
        .update(AgentHealthRefreshStatus.idle);
    return snapshot;
  }

  Future<AgentHealthSnapshot> _fetch() async {
    if (!_authorised) {
      throw StateError('Control Room access is not available for this role.');
    }
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
    if (!_authorised) return;
    final generation = _accessGeneration;
    final refreshStatus = ref.read(agentHealthRefreshStatusProvider.notifier);
    if (ref.read(agentHealthRefreshStatusProvider) ==
        AgentHealthRefreshStatus.refreshing) {
      return;
    }
    refreshStatus.update(AgentHealthRefreshStatus.refreshing);
    try {
      final snapshot = await _fetch();
      if (!_authorised || generation != _accessGeneration) return;
      state = AsyncData(snapshot);
      refreshStatus.update(AgentHealthRefreshStatus.idle);
    } on Object catch (error, stackTrace) {
      if (!_authorised || generation != _accessGeneration) return;
      refreshStatus.update(AgentHealthRefreshStatus.failed);
      if (!state.hasValue) {
        state = AsyncError(error, stackTrace);
      }
    }
  }
}

final agentHealthProvider =
    AsyncNotifierProvider.autoDispose<AgentHealthNotifier, AgentHealthSnapshot>(
      AgentHealthNotifier.new,
    );
