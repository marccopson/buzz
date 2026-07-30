# Jake-only MAC Assistant activation

COS-709 adds an offline, Desktop-mediated owner-attestation route for the
centrally provided MAC Assistant. It does not use managed-agent creation,
snapshot import, secret reveal or any local model-backed agent path.

The estate provisioner on brain-vps prepares
`mac-workspace/mac-assistant-activation-request/v1`. The strict request contains
only public routing and identity values: the Jake-only scope, the authoritative
Jake identity, one private channel, the public key derived from the
brain-vps-only assistant key, a random 256-bit challenge, a five-minute expiry
and the tailnet HTTPS Workspace origin. Unknown fields are rejected.

In Desktop, the action appears only inside the centrally provided MAC Assistant
card on Today, and only when the current signed-in identity and authoritative
COS projection both resolve to Jake Wherton. The dedicated Tauri command:

1. reads no private key from its arguments, environment, files or JSON;
2. obtains the current signing identity through `AppState::signing_keys`;
3. computes the existing NIP-OA tag for the requested assistant public key,
   bounded by the request expiry; and
4. signs an offline Nostr event containing the complete request and NIP-OA tag.

The event signature therefore binds the assistant key, challenge, identity,
channel, origin, issue time and expiry. The bundle is copied back to brain-vps;
Desktop does not publish it to a relay or retain the assistant key.

Estate verification is local-only:

```bash
buzz mac-assistant verify-activation \
  --request /protected/request.json \
  --attestation /protected/attestation.json
```

The command needs no relay or private-key environment. It rejects malformed or
unknown fields, an invalid Nostr signature, a signer other than the requested
Jake identity, altered request values, an expired request, unexpected tags and
an invalid or differently scoped NIP-OA tag.
