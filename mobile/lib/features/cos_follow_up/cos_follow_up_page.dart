import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import '../cos_user_context/cos_workspace_module_gate.dart';
import 'cos_follow_up.dart';
import 'cos_follow_up_provider.dart';

class CosFollowUpPage extends ConsumerWidget {
  const CosFollowUpPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      const CosWorkspaceModuleGate(
        title: 'My Actions',
        requiredModules: ['my_actions'],
        child: _AuthorisedCosFollowUpPage(),
      );
}

class _AuthorisedCosFollowUpPage extends ConsumerWidget {
  const _AuthorisedCosFollowUpPage();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(cosFollowUpProvider);
    final open = view.items
        .where((item) => item.state != CosFollowUpState.confirmed)
        .toList();
    final confirmed = view.items
        .where((item) => item.state == CosFollowUpState.confirmed)
        .take(20)
        .toList();

    return FrostedScaffold(
      appBar: FrostedAppBar(
        title: const Text('My Actions'),
        actions: [
          IconButton(
            tooltip: 'Refresh My Actions',
            onPressed: view.loading
                ? null
                : () => ref.read(cosFollowUpProvider.notifier).refresh(),
            icon: const Icon(LucideIcons.refreshCw),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.only(top: frostedAppBarHeight(context)),
          child: _body(context, ref, view, open, confirmed),
        ),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    CosFollowUpViewState view,
    List<CosFollowUpItem> open,
    List<CosFollowUpItem> confirmed,
  ) {
    if (view.loading && view.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (view.loadError != null && view.items.isEmpty) {
      return _LoadError(
        message: view.loadError!,
        onRetry: () => ref.read(cosFollowUpProvider.notifier).refresh(),
      );
    }
    return RefreshIndicator(
      onRefresh: () => ref.read(cosFollowUpProvider.notifier).refresh(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          Grid.gutter,
          Grid.xs,
          Grid.gutter,
          Grid.xxl,
        ),
        children: [
          Text(
            'Questions and checks that need you. Contractor OS stays authoritative.',
            style: context.textTheme.bodyMedium?.copyWith(
              color: context.colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: Grid.xs),
          if (open.isEmpty)
            const _EmptyActions()
          else
            for (final item in open) ...[
              _FollowUpCard(item: item),
              const SizedBox(height: Grid.twelve),
            ],
          if (confirmed.isNotEmpty) ...[
            const SizedBox(height: Grid.sm),
            Text('Recently confirmed', style: context.textTheme.titleMedium),
            const SizedBox(height: Grid.twelve),
            for (final item in confirmed) ...[
              _FollowUpCard(item: item),
              const SizedBox(height: Grid.twelve),
            ],
          ],
        ],
      ),
    );
  }
}

class _FollowUpCard extends ConsumerWidget {
  final CosFollowUpItem item;

  const _FollowUpCard({required this.item});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(cosFollowUpProvider);
    final pending = view.pendingItemIds.contains(item.id);
    final error = view.actionErrors[item.id];
    final notifier = ref.read(cosFollowUpProvider.notifier);

    return Card(
      key: ValueKey('my-actions-item-${item.id}'),
      child: Padding(
        padding: const EdgeInsets.all(Grid.xs),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: Grid.xxs,
              runSpacing: Grid.half,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _StateBadge(state: item.state),
                if (item.jiraKey != null)
                  Text(
                    item.jiraKey!,
                    style: context.textTheme.labelSmall?.copyWith(
                      fontFamily: 'GeistMono',
                      color: context.colors.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: Grid.xxs),
            Text(item.title, style: context.textTheme.titleMedium),
            const SizedBox(height: Grid.xxs),
            Text(item.question, style: context.textTheme.bodyMedium),
            if (item.evidence != null) ...[
              const SizedBox(height: Grid.twelve),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: context.colors.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(Radii.md),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(Grid.twelve),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Evidence', style: context.textTheme.labelSmall),
                      const SizedBox(height: Grid.half),
                      Text(item.evidence!, style: context.textTheme.bodySmall),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: Grid.xxs),
            Wrap(
              spacing: Grid.half,
              runSpacing: Grid.half,
              children: [
                if (item.deepLinks.jira != null)
                  _LinkButton(label: 'Jira', url: item.deepLinks.jira!),
                _LinkButton(
                  label: 'Contractor OS',
                  url: item.deepLinks.meetingFollowUp,
                ),
                for (final source in item.deepLinks.sources)
                  _LinkButton(label: source.label, url: source.url),
              ],
            ),
            if (item.state != CosFollowUpState.confirmed) ...[
              const SizedBox(height: Grid.twelve),
              Wrap(
                spacing: Grid.xxs,
                runSpacing: Grid.xxs,
                children: [
                  if (item.isActionPermitted(CosFollowUpHumanAction.answer))
                    FilledButton(
                      key: ValueKey('answer-${item.id}'),
                      onPressed: pending
                          ? null
                          : () async {
                              final answer = await _promptForText(
                                context,
                                title: 'Your answer',
                                required: true,
                              );
                              if (answer != null && context.mounted) {
                                await notifier.submitAction(
                                  item: item,
                                  action: CosFollowUpHumanAction.answer,
                                  answer: answer,
                                );
                              }
                            },
                      child: const Text('Answer'),
                    ),
                  if (item.isActionPermitted(CosFollowUpHumanAction.confirm))
                    FilledButton(
                      key: ValueKey('confirm-${item.id}'),
                      onPressed: pending
                          ? null
                          : () => notifier.submitAction(
                              item: item,
                              action: CosFollowUpHumanAction.confirm,
                            ),
                      child: const Text('That’s right'),
                    ),
                  if (item.isActionPermitted(CosFollowUpHumanAction.reject))
                    OutlinedButton(
                      key: ValueKey('reject-${item.id}'),
                      onPressed: pending
                          ? null
                          : () async {
                              final comment = await _promptForText(
                                context,
                                title: 'What is not right?',
                                required: false,
                              );
                              if (comment != null && context.mounted) {
                                await notifier.submitAction(
                                  item: item,
                                  action: CosFollowUpHumanAction.reject,
                                  comment: comment,
                                );
                              }
                            },
                      child: const Text('That’s not right'),
                    ),
                ],
              ),
              if (pending) ...[
                const SizedBox(height: Grid.xxs),
                const Row(
                  children: [
                    SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: Grid.xxs),
                    Expanded(
                      child: Text('Waiting for authoritative confirmation…'),
                    ),
                  ],
                ),
              ],
              if (error != null) ...[
                const SizedBox(height: Grid.xxs),
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: context.colors.errorContainer,
                    borderRadius: BorderRadius.circular(Radii.md),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(Grid.twelve),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            error.message,
                            style: context.textTheme.bodySmall?.copyWith(
                              color: context.colors.onErrorContainer,
                            ),
                          ),
                        ),
                        if (error.retryable)
                          TextButton(
                            onPressed: pending
                                ? null
                                : () => notifier.retryAction(item.id),
                            child: const Text('Retry'),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _StateBadge extends StatelessWidget {
  final CosFollowUpState state;

  const _StateBadge({required this.state});

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      CosFollowUpState.needsAnswer => context.colors.primary,
      CosFollowUpState.readyToCheck => context.appColors.warning,
      CosFollowUpState.confirmed => context.appColors.success,
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Grid.xxs,
          vertical: Grid.half,
        ),
        child: Text(
          cosFollowUpStateLabel(state),
          style: context.textTheme.labelSmall?.copyWith(color: color),
        ),
      ),
    );
  }
}

class _LinkButton extends StatelessWidget {
  final String label;
  final String url;

  const _LinkButton({required this.label, required this.url});

  @override
  Widget build(BuildContext context) => TextButton.icon(
    onPressed: () =>
        launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
    icon: const Icon(LucideIcons.externalLink, size: 16),
    label: Text(label),
  );
}

class _EmptyActions extends StatelessWidget {
  const _EmptyActions();

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(Grid.sm),
      child: Column(
        children: [
          Icon(
            LucideIcons.circleCheck,
            color: context.appColors.success,
            size: 28,
          ),
          const SizedBox(height: Grid.xxs),
          Text(
            'Nothing needs you right now',
            style: context.textTheme.titleSmall,
          ),
        ],
      ),
    ),
  );
}

class _LoadError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _LoadError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(Grid.gutter),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(LucideIcons.triangleAlert),
          const SizedBox(height: Grid.xxs),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: Grid.xxs),
          OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}

Future<String?> _promptForText(
  BuildContext context, {
  required String title,
  required bool required,
}) async {
  final controller = TextEditingController();
  final result = await showDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        minLines: 3,
        maxLines: 6,
        decoration: const InputDecoration(hintText: 'Type here…'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            final value = controller.text.trim();
            if (required && value.isEmpty) return;
            Navigator.pop(dialogContext, value);
          },
          child: const Text('Send'),
        ),
      ],
    ),
  );
  controller.dispose();
  return result;
}
