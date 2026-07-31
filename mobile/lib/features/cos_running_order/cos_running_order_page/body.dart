part of '../cos_running_order_page.dart';

class _RunningOrderBody extends StatelessWidget {
  final CosRunningOrderSnapshot snapshot;
  final _RunningOrderFilter filter;
  final ValueChanged<_RunningOrderFilter> onFilterChanged;
  final Future<void> Function() onRefresh;

  const _RunningOrderBody({
    required this.snapshot,
    required this.filter,
    required this.onFilterChanged,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    final items = snapshot.items.where((item) {
      return switch (filter) {
        _RunningOrderFilter.focus =>
          item.state != CosRunningOrderState.completed ||
              item.health != 'on_track',
        _RunningOrderFilter.needsManager => item.health == 'needs_manager',
        _RunningOrderFilter.ready => item.state == CosRunningOrderState.ready,
        _RunningOrderFilter.building =>
          item.state == CosRunningOrderState.building,
        _RunningOrderFilter.review =>
          item.state == CosRunningOrderState.independentReview,
        _RunningOrderFilter.verification =>
          item.state == CosRunningOrderState.stagingVerification,
        _RunningOrderFilter.complete =>
          item.state == CosRunningOrderState.completed,
      };
    }).toList();

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              Grid.gutter,
              Grid.md,
              Grid.gutter,
              Grid.sm,
            ),
            sliver: SliverList.list(
              children: [
                _HealthCard(snapshot: snapshot),
                const SizedBox(height: Grid.sm),
                _SummaryGrid(counts: snapshot.counts),
                const SizedBox(height: Grid.sm),
                FilterChipBar<_RunningOrderFilter>(
                  selected: filter,
                  onSelected: onFilterChanged,
                  items: const [
                    FilterChipItem(
                      id: _RunningOrderFilter.focus,
                      label: 'Focus',
                    ),
                    FilterChipItem(
                      id: _RunningOrderFilter.needsManager,
                      label: 'Needs you',
                    ),
                    FilterChipItem(
                      id: _RunningOrderFilter.building,
                      label: 'Building',
                    ),
                    FilterChipItem(
                      id: _RunningOrderFilter.review,
                      label: 'Review',
                    ),
                    FilterChipItem(
                      id: _RunningOrderFilter.ready,
                      label: 'Ready',
                    ),
                    FilterChipItem(
                      id: _RunningOrderFilter.verification,
                      label: 'Verify',
                    ),
                    FilterChipItem(
                      id: _RunningOrderFilter.complete,
                      label: 'Complete',
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (items.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: _EmptyRunningOrder(),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                0,
                Grid.gutter,
                Grid.xl,
              ),
              sliver: SliverList.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const SizedBox(height: Grid.sm),
                itemBuilder: (context, index) =>
                    _RunningOrderCard(item: items[index]),
              ),
            ),
        ],
      ),
    );
  }
}

class _HealthCard extends StatelessWidget {
  final CosRunningOrderSnapshot snapshot;

  const _HealthCard({required this.snapshot});

  @override
  Widget build(BuildContext context) {
    final healthy = snapshot.sourceStatus == 'fresh';
    final colors = context.colors;
    final generated = snapshot.generatedAt == null
        ? 'Unknown'
        : DateFormat('d MMM, HH:mm').format(snapshot.generatedAt!.toLocal());
    return DecoratedBox(
      decoration: BoxDecoration(
        color: healthy
            ? colors.primaryContainer.withValues(alpha: 0.42)
            : colors.errorContainer,
        borderRadius: BorderRadius.circular(Radii.lg),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Grid.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              healthy ? LucideIcons.shieldCheck : LucideIcons.triangleAlert,
              color: healthy
                  ? colors.onPrimaryContainer
                  : colors.onErrorContainer,
            ),
            const SizedBox(width: Grid.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    healthy ? 'Evidence current' : 'Evidence needs attention',
                    style: context.textTheme.titleSmall,
                  ),
                  const SizedBox(height: Grid.quarter),
                  Text(
                    'Read-only delivery view · Updated $generated',
                    style: context.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryGrid extends StatelessWidget {
  final CosRunningOrderCounts counts;

  const _SummaryGrid({required this.counts});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _SummaryValue(label: 'Needs you', value: counts.needsManager),
        ),
        const SizedBox(width: Grid.half),
        Expanded(
          child: _SummaryValue(label: 'Building', value: counts.building),
        ),
        const SizedBox(width: Grid.half),
        Expanded(
          child: _SummaryValue(
            label: 'Review',
            value: counts.independentReview,
          ),
        ),
        const SizedBox(width: Grid.half),
        Expanded(
          child: _SummaryValue(
            label: 'Verify',
            value: counts.stagingVerification,
          ),
        ),
        const SizedBox(width: Grid.half),
        Expanded(
          child: _SummaryValue(
            label: 'Blocked',
            value: counts.blockedOrStalled,
          ),
        ),
      ],
    );
  }
}

class _SummaryValue extends StatelessWidget {
  final String label;
  final int value;

  const _SummaryValue({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: context.colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(Radii.md),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Grid.half,
          vertical: Grid.sm,
        ),
        child: Column(
          children: [
            Text('$value', style: context.textTheme.titleMedium),
            Text(label, style: context.textTheme.labelSmall),
          ],
        ),
      ),
    );
  }
}

class _RunningOrderCard extends StatelessWidget {
  final CosRunningOrderItem item;

  const _RunningOrderCard({required this.item});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final stateLabel = switch (item.state) {
      CosRunningOrderState.ready => 'Ready',
      CosRunningOrderState.building => 'Building',
      CosRunningOrderState.independentReview => 'Independent review',
      CosRunningOrderState.stagingVerification => 'Staging verification',
      CosRunningOrderState.completed => 'Completed',
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerLow,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Grid.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  item.key,
                  style: context.textTheme.labelLarge?.copyWith(
                    color: colors.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                Text(stateLabel, style: context.textTheme.labelSmall),
              ],
            ),
            const SizedBox(height: Grid.half),
            Text(item.title, style: context.textTheme.titleSmall),
            const SizedBox(height: Grid.quarter),
            Text(
              '${item.owner.isEmpty ? 'Unassigned' : item.owner} · ${item.health.replaceAll('_', ' ')}',
              style: context.textTheme.bodySmall,
            ),
            if (item.currentActivity.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Grid.half),
                child: Text(
                  item.currentActivity,
                  style: context.textTheme.bodyMedium,
                ),
              ),
            if (item.nextAction.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Grid.half),
                child: Text(
                  'Next: ${item.nextAction}',
                  style: context.textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _EmptyRunningOrder extends StatelessWidget {
  const _EmptyRunningOrder();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.xl),
        child: Text(
          'Nothing in this view.',
          style: context.textTheme.bodyMedium,
        ),
      ),
    );
  }
}

class _RunningOrderError extends StatelessWidget {
  final VoidCallback onRetry;

  const _RunningOrderError({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(LucideIcons.triangleAlert),
            const SizedBox(height: Grid.sm),
            const Text('Delivery Room unavailable'),
            const SizedBox(height: Grid.sm),
            FilledButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}
