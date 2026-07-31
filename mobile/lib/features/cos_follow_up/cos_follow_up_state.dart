import 'cos_follow_up.dart';

class CosFollowUpActionError {
  final String message;
  final bool retryable;
  final String? code;

  const CosFollowUpActionError({
    required this.message,
    required this.retryable,
    this.code,
  });
}

class CosFollowUpViewState {
  final List<CosFollowUpItem> items;
  final bool loading;
  final String? loadError;
  final Set<String> pendingItemIds;
  final Map<String, CosFollowUpActionError> actionErrors;

  const CosFollowUpViewState({
    this.items = const [],
    this.loading = true,
    this.loadError,
    this.pendingItemIds = const {},
    this.actionErrors = const {},
  });

  CosFollowUpViewState copyWith({
    List<CosFollowUpItem>? items,
    bool? loading,
    String? loadError,
    bool clearLoadError = false,
    Set<String>? pendingItemIds,
    Map<String, CosFollowUpActionError>? actionErrors,
  }) => CosFollowUpViewState(
    items: items ?? this.items,
    loading: loading ?? this.loading,
    loadError: clearLoadError ? null : loadError ?? this.loadError,
    pendingItemIds: pendingItemIds ?? this.pendingItemIds,
    actionErrors: actionErrors ?? this.actionErrors,
  );
}
