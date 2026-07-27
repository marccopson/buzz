import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/filter_chip_bar.dart';
import '../../shared/widgets/frosted_app_bar.dart';
import '../../shared/widgets/frosted_scaffold.dart';
import 'cos_running_order.dart';
import 'cos_running_order_provider.dart';

part 'cos_running_order_page/body.dart';

enum _RunningOrderFilter { focus, blocked, running, ready, humanTest, queued }

class CosRunningOrderPage extends HookConsumerWidget {
  const CosRunningOrderPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshotAsync = ref.watch(cosRunningOrderProvider);
    final filter = useState(_RunningOrderFilter.focus);
    final cachedSnapshot = useRef<CosRunningOrderSnapshot?>(null);
    if (snapshotAsync.asData?.value case final snapshot?) {
      cachedSnapshot.value = snapshot;
    }

    final Widget body;
    if (cachedSnapshot.value case final snapshot?) {
      body = _RunningOrderBody(
        snapshot: snapshot,
        filter: filter.value,
        onFilterChanged: (value) => filter.value = value,
        onRefresh: () => ref.read(cosRunningOrderProvider.notifier).refresh(),
      );
    } else if (snapshotAsync.hasError) {
      body = _RunningOrderError(
        onRetry: () => ref.read(cosRunningOrderProvider.notifier).refresh(),
      );
    } else {
      body = const Center(child: CircularProgressIndicator());
    }

    return FrostedScaffold(
      appBar: const FrostedAppBar(title: Text('COS Running Order')),
      body: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.only(top: frostedAppBarHeight(context)),
          child: body,
        ),
      ),
    );
  }
}
