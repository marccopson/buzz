import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'cos_user_context_provider.dart';

class CosWorkspaceModuleGate extends ConsumerWidget {
  final String title;
  final List<String> requiredModules;
  final Widget child;

  const CosWorkspaceModuleGate({
    required this.title,
    required this.requiredModules,
    required this.child,
    super.key,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final result = ref.watch(cosUserContextProvider);
    final workspaceContext = currentCosUserContext(result);
    final permitted =
        workspaceContext != null &&
        requiredModules.every(workspaceContext.hasModule);
    if (permitted) return child;

    return FrostedScaffold(
      appBar: FrostedAppBar(title: Text(title)),
      body: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.only(top: frostedAppBarHeight(context)),
          child: Center(
            child: result.isLoading
                ? const CircularProgressIndicator()
                : const Padding(
                    padding: EdgeInsets.all(Grid.gutter),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Access not available',
                          textAlign: TextAlign.center,
                        ),
                        SizedBox(height: Grid.sm),
                        Text(
                          'Contractor OS has not enabled this tool for your role.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
