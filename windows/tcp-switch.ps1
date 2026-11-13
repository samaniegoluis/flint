# A TCP forwarder on Windows' loopback whose first -Firsts connections reach -First and
# every later one -Later (both on 127.0.0.1): one address, two servers. The rdp run of
# windows/gui-e2e.sh uses it for a changed certificate, as scripts/gui-e2e.sh's fwd.py
# does on macOS and Linux (a Windows program here: the servers listen on Windows).
#
# With -Peek, only connections whose client speaks first (RDP) are counted, so a probe
# that opens and closes one without sending anything (milestone 35's round-trip dial)
# neither reaches a server nor moves the count, as fwd.py's "peek".
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File tcp-switch.ps1 -Port 40000 -First 33891 -Later 33895 -Firsts 2 [-Peek]
param([int]$Port, [int]$First, [int]$Later, [int]$Firsts = 1, [switch]$Peek)

Add-Type -TypeDefinition @"
using System;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;

public static class TcpSwitch {
    static readonly object Gate = new object();
    static int n = 0;

    public static void Run(int port, int first, int later, int firsts, bool peek) {
        var listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        Console.WriteLine("switch: 127.0.0.1:" + port + " -> " + first + " x" + firsts + ", then " + later);
        Console.Out.Flush();
        while (true) {
            var client = listener.AcceptTcpClient();
            if (!peek) {
                int target;
                lock (Gate) { target = n < firsts ? first : later; n++; }
                Task.Run(() => Serve(client, target));
                continue;
            }
            Task.Run(() => {
                try {
                    var one = new byte[1];
                    if (client.Client.Receive(one, 0, 1, SocketFlags.Peek) == 0) { client.Close(); return; }
                } catch { try { client.Close(); } catch {} return; }
                int target;
                lock (Gate) { target = n < firsts ? first : later; n++; }
                Serve(client, target);
            });
        }
    }

    static void Pipe(NetworkStream a, Socket b) {
        try {
            var buf = new byte[65536];
            int k;
            while ((k = a.Read(buf, 0, buf.Length)) > 0) b.Send(buf, 0, k, SocketFlags.None);
        } catch {}
        try { b.Shutdown(SocketShutdown.Send); } catch {}
    }

    static void Serve(TcpClient client, int target) {
        try {
            client.NoDelay = true;
            var up = new TcpClient();
            up.NoDelay = true;
            up.Connect(IPAddress.Loopback, target);
            var t1 = Task.Run(() => Pipe(client.GetStream(), up.Client));
            var t2 = Task.Run(() => Pipe(up.GetStream(), client.Client));
            Task.WaitAll(t1, t2);
            up.Close();
        } catch {}
        try { client.Close(); } catch {}
    }
}
"@

[TcpSwitch]::Run($Port, $First, $Later, $Firsts, $Peek.IsPresent)
