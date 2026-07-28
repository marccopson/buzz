import 'dart:convert';
import 'dart:typed_data';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:pointycastle/ecc/curves/secp256k1.dart';

import '../../shared/relay/relay_provider.dart';

const cosFollowUpAuthoritySchema = 'mac-workspace/cos-follow-up-authority/v1';
const cosFollowUpChannelMapping = 'signed-item-h-p-v1';

final cosFollowUpAuthorityHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

/// Strictly parses the relay's COS bridge authority extension.
///
/// Any missing, malformed, or non-canonical value disables projection.
String? parseCosFollowUpBridgePubkey(Object? document) {
  if (document is! Map) return null;
  final authority = document['cos_follow_up'];
  if (authority is! Map ||
      authority['schema'] != cosFollowUpAuthoritySchema ||
      authority['channel_mapping'] != cosFollowUpChannelMapping) {
    return null;
  }
  final pubkey = authority['bridge_pubkey'];
  if (pubkey is! String || !_isValidNostrXOnlyPubkey(pubkey)) {
    return null;
  }
  return pubkey;
}

bool _isValidNostrXOnlyPubkey(String value) {
  if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(value)) return false;
  try {
    final compressed = Uint8List(33)..[0] = 0x02;
    for (var index = 0; index < 32; index++) {
      compressed[index + 1] = int.parse(
        value.substring(index * 2, index * 2 + 2),
        radix: 16,
      );
    }
    return ECCurve_secp256k1().curve.decodePoint(compressed) != null;
  } on Object {
    return false;
  }
}

final cosFollowUpBridgePubkeyProvider = FutureProvider<String?>((ref) async {
  final relayUrl = ref.watch(relayConfigProvider).baseUrl;
  final uri = _relayInformationUri(relayUrl);
  if (uri == null) return null;
  try {
    final response = await ref
        .read(cosFollowUpAuthorityHttpClientProvider)
        .get(uri, headers: const {'Accept': 'application/nostr+json'})
        .timeout(const Duration(seconds: 5));
    if (response.statusCode < 200 || response.statusCode >= 300) return null;
    return parseCosFollowUpBridgePubkey(jsonDecode(response.body));
  } catch (_) {
    return null;
  }
});

Uri? _relayInformationUri(String relayUrl) {
  try {
    final uri = Uri.parse(relayUrl.trim());
    final scheme = switch (uri.scheme) {
      'wss' => 'https',
      'ws' => 'http',
      'https' || 'http' => uri.scheme,
      _ => null,
    };
    return scheme == null ? null : uri.replace(scheme: scheme);
  } on FormatException {
    return null;
  }
}
