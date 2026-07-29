import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../cos_running_order/cos_running_order_page.dart';
import 'agent_health.dart';
import 'agent_health_provider.dart';

class ControlRoomPage extends ConsumerWidget {
  const ControlRoomPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(agentHealthProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Control Room'),
        actions: [
          IconButton(
            tooltip: 'Delivery',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const CosRunningOrderPage(),
              ),
            ),
            icon: const Icon(LucideIcons.listChecks),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: snapshot.isLoading
                ? null
                : () => ref.read(agentHealthProvider.notifier).refresh(),
            icon: const Icon(LucideIcons.refreshCw),
          ),
        ],
      ),
      body: snapshot.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _Unavailable(
          message: error.toString(),
          onRetry: () => ref.read(agentHealthProvider.notifier).refresh(),
        ),
        data: (health) => RefreshIndicator(
          onRefresh: () => ref.read(agentHealthProvider.notifier).refresh(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.md,
              Grid.gutter,
              96,
            ),
            children: [
              Text(
                'Estate and brain-agent health, with unknowns shown honestly.',
                style: context.textTheme.bodyMedium?.copyWith(
                  color: context.colors.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: Grid.md),
              _Summary(snapshot: health),
              if (health.sourceStatus != HealthSourceStatus.fresh) ...[
                const SizedBox(height: Grid.md),
                _SourceWarning(status: health.sourceStatus),
              ],
              if (health.issues.isNotEmpty) ...[
                const SizedBox(height: Grid.md),
                _Issues(issues: health.issues),
              ],
              const SizedBox(height: Grid.lg),
              const _SectionTitle('Estate nodes'),
              const SizedBox(height: Grid.sm),
              ...health.nodes.map(
                (record) => _HealthCard(
                  record,
                  current: health.sourceStatus == HealthSourceStatus.fresh,
                ),
              ),
              const SizedBox(height: Grid.lg),
              const _SectionTitle('Brain agents'),
              const SizedBox(height: Grid.sm),
              ...health.agents.map(
                (agent) => _AgentCard(
                  agent,
                  current: health.sourceStatus == HealthSourceStatus.fresh,
                ),
              ),
              const SizedBox(height: Grid.lg),
              const _SectionTitle('Core components'),
              const SizedBox(height: Grid.sm),
              ...health.components.map(
                (record) => _HealthCard(
                  record,
                  current: health.sourceStatus == HealthSourceStatus.fresh,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  final AgentHealthSnapshot snapshot;

  const _Summary({required this.snapshot});

  @override
  Widget build(BuildContext context) {
    final isCurrent = snapshot.sourceStatus == HealthSourceStatus.fresh;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: _Panel(
            icon: _statusIcon(
              isCurrent ? snapshot.operationalStatus : HealthStatus.red,
            ),
            title: 'Operational',
            value: isCurrent
                ? _statusLabel(snapshot.operationalStatus)
                : switch (snapshot.sourceStatus) {
                    HealthSourceStatus.stale => 'Evidence stale',
                    HealthSourceStatus.invalid => 'Evidence invalid',
                    HealthSourceStatus.fresh => 'Unavailable',
                  },
            detail: isCurrent
                ? 'Updated ${_formatTime(snapshot.generatedAt)}'
                : 'Last known ${_formatTime(snapshot.generatedAt)}',
          ),
        ),
        const SizedBox(width: Grid.sm),
        Expanded(
          child: _Panel(
            icon: LucideIcons.shieldCheck,
            title: 'Assurance',
            value: snapshot.assuranceStatus.name,
            detail: snapshot.assuranceGaps.isEmpty
                ? 'Complete evidence'
                : '${snapshot.assuranceGaps.length} known gap(s)',
          ),
        ),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  final IconData icon;
  final String title;
  final String value;
  final String detail;

  const _Panel({
    required this.icon,
    required this.title,
    required this.value,
    required this.detail,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(Grid.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: context.colors.primary),
            const SizedBox(height: Grid.sm),
            Text(title, style: context.textTheme.labelMedium),
            Text(
              value,
              style: context.textTheme.titleMedium,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: Grid.half),
            Text(
              detail,
              style: context.textTheme.bodySmall?.copyWith(
                color: context.colors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AgentCard extends StatelessWidget {
  final AgentHealthRecord agent;
  final bool current;

  const _AgentCard(this.agent, {required this.current});

  @override
  Widget build(BuildContext context) {
    return Card(
      key: ValueKey('control-room-agent-${agent.id}'),
      margin: const EdgeInsets.only(bottom: Grid.sm),
      child: Padding(
        padding: const EdgeInsets.all(Grid.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  _statusIcon(agent.operationalStatus),
                  size: 18,
                  color: _statusColor(context, agent.operationalStatus),
                ),
                const SizedBox(width: Grid.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(agent.name, style: context.textTheme.titleMedium),
                      Text(
                        current
                            ? 'Operational ${_statusLabel(agent.operationalStatus)}'
                            : 'Last known: ${_statusLabel(agent.operationalStatus)}',
                        style: context.textTheme.labelSmall,
                      ),
                    ],
                  ),
                ),
                Text(
                  'Assurance ${agent.assuranceStatus.name}',
                  style: context.textTheme.labelSmall,
                ),
              ],
            ),
            const SizedBox(height: Grid.md),
            Wrap(
              spacing: Grid.sm,
              runSpacing: Grid.sm,
              children: agent.dimensions.entries.map((entry) {
                final state = entry.value.state;
                return Chip(
                  avatar: Icon(switch (state) {
                    HealthDimensionState.pass => LucideIcons.circleCheck,
                    HealthDimensionState.warn => LucideIcons.triangleAlert,
                    HealthDimensionState.fail => LucideIcons.triangleAlert,
                    HealthDimensionState.unknown => LucideIcons.circleHelp,
                  }, size: 15),
                  label: Text(
                    '${entry.key} · ${_dimensionLabel(entry.value.state)}',
                  ),
                  visualDensity: VisualDensity.compact,
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }
}

class _HealthCard extends StatelessWidget {
  final HealthRecord record;
  final bool current;

  const _HealthCard(this.record, {required this.current});

  @override
  Widget build(BuildContext context) {
    return Card(
      key: ValueKey('control-room-health-${record.id}'),
      margin: const EdgeInsets.only(bottom: Grid.sm),
      child: ListTile(
        leading: Icon(
          _statusIcon(record.status),
          color: _statusColor(context, record.status),
        ),
        title: Text(record.name),
        subtitle: Text(record.detail),
        trailing: Text(
          current
              ? _statusLabel(record.status)
              : 'Last known: ${_statusLabel(record.status)}',
        ),
      ),
    );
  }
}

class _SourceWarning extends StatelessWidget {
  final HealthSourceStatus status;

  const _SourceWarning({required this.status});

  @override
  Widget build(BuildContext context) {
    final label = status == HealthSourceStatus.stale
        ? 'Evidence stale'
        : 'Evidence invalid';
    return Card(
      color: context.colors.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(Grid.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: context.textTheme.titleSmall),
            const SizedBox(height: Grid.sm),
            const Text(
              'Values below are last-known evidence and are not current health.',
            ),
          ],
        ),
      ),
    );
  }
}

class _Issues extends StatelessWidget {
  final List<String> issues;

  const _Issues({required this.issues});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: context.colors.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(Grid.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Needs attention', style: context.textTheme.titleSmall),
            for (final issue in issues)
              Padding(
                padding: const EdgeInsets.only(top: Grid.sm),
                child: Text(issue),
              ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;

  const _SectionTitle(this.title);

  @override
  Widget build(BuildContext context) {
    return Text(title, style: context.textTheme.titleSmall);
  }
}

class _Unavailable extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _Unavailable({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(LucideIcons.triangleAlert),
            const SizedBox(height: Grid.sm),
            const Text('Control Room unavailable'),
            const SizedBox(height: Grid.sm),
            Text(message, textAlign: TextAlign.center),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

String _statusLabel(HealthStatus status) => switch (status) {
  HealthStatus.green => 'Healthy',
  HealthStatus.amber => 'Attention',
  HealthStatus.red => 'Unavailable',
};

IconData _statusIcon(HealthStatus status) => switch (status) {
  HealthStatus.green => LucideIcons.circleCheck,
  HealthStatus.amber => LucideIcons.triangleAlert,
  HealthStatus.red => LucideIcons.circleX,
};

String _dimensionLabel(HealthDimensionState state) => switch (state) {
  HealthDimensionState.pass => 'Pass',
  HealthDimensionState.warn => 'Warning',
  HealthDimensionState.fail => 'Fail',
  HealthDimensionState.unknown => 'Unknown',
};

Color _statusColor(BuildContext context, HealthStatus status) =>
    switch (status) {
      HealthStatus.green => Colors.green,
      HealthStatus.amber => Colors.orange,
      HealthStatus.red => context.colors.error,
    };

String _formatTime(DateTime? value) {
  if (value == null) return 'unknown';
  final local = value.toLocal();
  return '${local.day.toString().padLeft(2, '0')}/'
      '${local.month.toString().padLeft(2, '0')} '
      '${local.hour.toString().padLeft(2, '0')}:'
      '${local.minute.toString().padLeft(2, '0')}';
}
