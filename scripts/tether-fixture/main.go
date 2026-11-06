// Writes a Tether vault for Flint's import tests with Tether's own store and
// keystore packages, so the fixture is exactly what Tether writes (Argon2id with
// four lanes, XChaCha20-Poly1305 per field, plain SQLite). Run through
// scripts/make-tether-fixture.sh, which overlays this file into Tether's module.
//
//	go run -overlay overlay.json ./cmd/flintfixture <out.tether> <key file> <key passphrase> <legacy key path>
package main

import (
	"fmt"
	"os"

	"golang.org/x/crypto/ssh"

	"tether/internal/keystore"
	"tether/internal/store"
)

const master = "tether-fixture-pw"

func must[T any](v T, err error) T {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	return v
}

func ptr(s string) *string { return &s }

func main() {
	out, keyFile, keyPass, legacyPath := os.Args[1], os.Args[2], os.Args[3], os.Args[4]
	s := must(store.Create(out))
	defer s.Close()
	ks := keystore.New(s)
	if err := ks.SetMaster(master); err != nil {
		panic(err)
	}
	must(0, s.SetSetting("vault.id", "fixture-vault-id"))
	enc := func(v string) string { return must(ks.EncryptSecret([]byte(v))) }

	// Groups: Homelab/Proxmox/Nodes (three deep), Work, and a name Flint cannot keep as is.
	homelab := must(s.CreateGroup(store.Group{Name: "Homelab"}))
	proxmox := must(s.CreateGroup(store.Group{Name: "Proxmox", ParentID: &homelab.ID}))
	nodes := must(s.CreateGroup(store.Group{Name: "Nodes", ParentID: &proxmox.ID}))
	work := must(s.CreateGroup(store.Group{Name: "Work"}))
	clients := must(s.CreateGroup(store.Group{Name: "Clients / ACME", ParentID: &work.ID}))

	// A stored key with a passphrase.
	pem := string(must(os.ReadFile(keyFile)))
	signer := must(ssh.ParsePrivateKeyWithPassphrase([]byte(pem), []byte(keyPass)))
	pub := signer.PublicKey()
	key := must(s.CreateSSHKey(store.SSHKey{
		Name: "homelab ed25519", Type: pub.Type(), Fingerprint: ssh.FingerprintSHA256(pub),
		PublicKey: string(ssh.MarshalAuthorizedKey(pub)),
		PrivateKeyEnc: enc(pem), PassphraseEnc: enc(keyPass),
	}))

	cred := must(s.CreateCredential(store.Credential{Name: "ops", Username: "ops", AuthType: "password", PasswordEnc: enc("pw-ops-cred")}))

	codebox := must(s.CreateHost(store.Host{
		Label: "Code Box", Hostname: "codebox.lan", Port: 22, Username: "luis", AuthType: "password",
		GroupID: &homelab.ID, Tags: []string{"dev", "home lab"}, Color: "#ff8800",
		Notes: "main dev box\nsecond line", InitialCommand: "herdr",
	}))
	must(0, s.SetHostPassword(codebox.ID, enc("pw-codebox")))

	pve := must(s.CreateHost(store.Host{
		Label: "pve-01", Hostname: "pve-01.lan", Port: 2222, Username: "root", AuthType: "key",
		KeyID: &key.ID, GroupID: &nodes.ID,
	}))
	must(s.CreateHost(store.Host{
		Label: "Web (prod)", Hostname: "web.example.com", Port: 22, Username: "deploy", AuthType: "agent",
		GroupID: &clients.ID, JumpHostID: &codebox.ID,
	}))
	must(s.CreateHost(store.Host{
		Label: "db", Hostname: "10.0.0.5", Port: 22, AuthType: "password", CredentialID: &cred.ID,
	}))
	// Same label as an earlier host, another machine: the alias needs a suffix.
	must(s.CreateHost(store.Host{
		Label: "Code Box", Hostname: "codebox2.lan", Port: 22, Username: "luis", AuthType: "agent",
	}))
	// An exact duplicate of the first Code Box: imported once.
	must(s.CreateHost(store.Host{
		Label: "Code Box", Hostname: "codebox.lan", Port: 22, Username: "luis", AuthType: "agent",
	}))
	must(s.CreateHost(store.Host{
		Label: "Ñandú Server!", Hostname: "nandu.lan", Port: 22, Username: "root", AuthType: "agent",
		Color: "red",
	}))
	must(s.CreateHost(store.Host{
		Label: "legacy", Hostname: "legacy.lan", Port: 22, Username: "admin", AuthType: "key",
		KeyPath: legacyPath,
	}))
	must(s.CreateHost(store.Host{
		Label: "gone key", Hostname: "gone.lan", Port: 22, Username: "admin", AuthType: "key",
		KeyPath: "/nonexistent/flint-fixture/id_missing",
	}))

	must(s.CreateTunnel(store.Tunnel{HostID: pve.ID, Name: "proxmox ui", LocalPort: 8006, RemoteHost: "localhost", RemotePort: 8006}))

	must(0, s.UpsertKnownHost(store.KnownHost{Addr: "codebox.lan:22", KeyType: "ssh-ed25519", Fingerprint: "SHA256:fixtureCodeboxFingerprint", HostID: &codebox.ID}))
	must(0, s.UpsertKnownHost(store.KnownHost{Addr: "pve-01.lan:2222", KeyType: "ecdsa-sha2-nistp256", Fingerprint: "SHA256:fixturePveFingerprint", HostID: &pve.ID}))
	must(0, s.UpsertKnownHost(store.KnownHost{Addr: "[fe80::1]:22", KeyType: "ssh-ed25519", Fingerprint: "SHA256:fixtureV6Fingerprint"}))
	fmt.Println("wrote", out)
}
