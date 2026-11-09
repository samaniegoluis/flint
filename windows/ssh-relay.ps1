# Relays TCP connections from Windows' loopback into WSL.
#
# On this WSL (2.4.13, networkingMode=mirrored) TCP to 127.0.0.1 is routed to Windows
# through `loopback0` (ip rule -> table 127) and does not come back: neither Windows nor
# Linux itself reaches a Linux listener on 127.0.0.1 (connect times out). 127.0.0.2
# stays local to Linux, and binding the throwaway sshd to 0.0.0.0 or the LAN address
# would expose it. So the sshd listens on 127.0.0.2, and each client accepted on
# Windows' 127.0.0.1:<Port> gets its own `wsl.exe -e nc -N <TargetHost> <Target>`, with
# bytes copied both ways. Nothing listens beyond loopback on either side.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File ssh-relay.ps1 -Port 2322 -TargetHost 127.0.0.2 -Target 2222
#
# -ListenHost 127.0.0.2 listens on Windows' own 127.0.0.2 instead: with the same port
# on both sides, `127.0.0.2:<port>` then names the same sshd from Windows and from
# inside WSL (a jump host dialling the next hop), which windows/gui-e2e.sh needs.
param([int]$Port = 2322, [string]$TargetHost = "127.0.0.2", [int]$Target = 2222, [string]$Distro = "Ubuntu-24.04", [string]$ListenHost = "127.0.0.1")

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;

public static class WslRelay {
    public static void Run(string listen, int port, string host, int target, string distro) {
        var listener = new TcpListener(IPAddress.Parse(listen), port);
        listener.Start();
        Console.WriteLine("relay: " + listen + ":" + port + " -> WSL " + host + ":" + target);
        Console.Out.Flush();
        while (true) {
            var client = listener.AcceptTcpClient();
            client.NoDelay = true;
            Task.Run(() => Serve(client, host, target, distro));
        }
    }

    static void Serve(TcpClient client, string host, int target, string distro) {
        var psi = new ProcessStartInfo("wsl.exe", "-d " + distro + " -e nc -N " + host + " " + target);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var proc = Process.Start(psi);
        proc.ErrorDataReceived += (s, e) => {};
        proc.BeginErrorReadLine();
        var net = client.GetStream();
        var up = Task.Run(() => {
            // The child's stdin is a buffered FileStream: flush every chunk, or the
            // SSH handshake waits on bytes sitting in the buffer.
            try {
                var buf = new byte[65536];
                var dst = proc.StandardInput.BaseStream;
                int n;
                while ((n = net.Read(buf, 0, buf.Length)) > 0) { dst.Write(buf, 0, n); dst.Flush(); }
            } catch {}
            try { proc.StandardInput.Close(); } catch {}
        });
        var down = Task.Run(() => {
            try {
                var buf = new byte[65536];
                var src = proc.StandardOutput.BaseStream;
                int n;
                while ((n = src.Read(buf, 0, buf.Length)) > 0) net.Write(buf, 0, n);
            } catch {}
            try { client.Client.Shutdown(SocketShutdown.Send); } catch {}
        });
        Task.WaitAll(up, down);
        try { client.Close(); } catch {}
        try { if (!proc.HasExited) proc.Kill(); } catch {}
    }
}
"@

[WslRelay]::Run($ListenHost, $Port, $TargetHost, $Target, $Distro)
