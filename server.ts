import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  // Set up socket.io with generous CORS boundaries for browser peerings
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Simple health probe
  app.get("/api/health", (req, res) => {
    res.json({ status: "alive" });
  });

  // Track online/searching users
  interface Searcher {
    socketId: string;
    interests: string[];
    mode: "text" | "video";
    socket: any;
  }

  let searchingPool: Searcher[] = [];
  const activePairs = new Map<string, string>(); // socketId -> strangerSocketId

  io.on("connection", (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);
    
    // Broadcast active count to all participants instantly
    io.emit("stats-update", { count: io.engine.clientsCount });

    // Clean up active states for a socket
    const cleanUpUser = () => {
      // 1. Remove from searching list
      searchingPool = searchingPool.filter(s => s.socketId !== socket.id);

      // 2. Clear paired socket and notify partner
      const partnerId = activePairs.get(socket.id);
      if (partnerId) {
        io.to(partnerId).emit("stranger-disconnected");
        activePairs.delete(socket.id);
        activePairs.delete(partnerId);

        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
          (partnerSocket as any).sessionState = "idle";
        }
      }
    };

    // Begin search event
    socket.on("start-search", ({ interests, mode }: { interests: string[]; mode: "text" | "video" }) => {
      cleanUpUser();

      const normalizedInterests = (interests || [])
        .map(i => i.trim().toLowerCase())
        .filter(Boolean);

      const userObject: Searcher = {
        socketId: socket.id,
        interests: normalizedInterests,
        mode,
        socket
      };

      // Matchmaker logic
      const match = findMatch(userObject);

      if (match) {
        // Remove partner from search pool
        searchingPool = searchingPool.filter(s => s.socketId !== match.socketId);

        // Bind pairs
        activePairs.set(socket.id, match.socketId);
        activePairs.set(match.socketId, socket.id);

        const commonInterests = userObject.interests.filter(i =>
          match.interests.includes(i)
        );

        // Peer-A (Initiator) matches and will fire WebRTC offer
        socket.emit("paired", {
          peerId: match.socketId,
          initiator: true,
          commonInterests
        });

        // Peer-B (Receiver) matches and will receive offer
        match.socket.emit("paired", {
          peerId: socket.id,
          initiator: false,
          commonInterests
        });

        console.log(`[Match] Paired Initiator ${socket.id} with Guest ${match.socketId} on ${mode} mode.`);
      } else {
        // No match found immediately, place in searching pool
        searchingPool.push(userObject);
        socket.emit("searching", { interests: normalizedInterests });
        console.log(`[Search] Listed ${socket.id} in pool for ${mode}. interests: ${normalizedInterests}`);
      }
    });

    // Helper: Select suitable stranger based on common interests first, or oldest wait time
    function findMatch(user: Searcher): Searcher | null {
      const candidates = searchingPool.filter(
        c => c.socketId !== user.socketId && c.mode === user.mode
      );
      if (candidates.length === 0) return null;

      let bestMatch: Searcher | null = null;
      let maxIntersection = 0;

      // 1. Try to find the candidate with the highest overlap of interests
      if (user.interests.length > 0) {
        for (const cand of candidates) {
          if (cand.interests.length > 0) {
            const common = user.interests.filter(i => cand.interests.includes(i));
            if (common.length > maxIntersection) {
              maxIntersection = common.length;
              bestMatch = cand;
            }
          }
        }
      }

      if (bestMatch) {
        return bestMatch;
      }

      // 2. Base case: fall back to the user who has been waiting longest (index 0)
      return candidates[0];
    }

    // Stop matching search
    socket.on("stop-search", () => {
      cleanUpUser();
      socket.emit("idle");
    });

    // WebRTC Signaling Proxy
    socket.on("webrtc-signal", ({ to, signal }: { to: string; signal: any }) => {
      const partnerId = activePairs.get(socket.id);
      if (partnerId === to) {
        io.to(partnerId).emit("webrtc-signal", {
          from: socket.id,
          signal
        });
      }
    });

    // Send instant chat message
    socket.on("chat-message", ({ text }: { text: string }) => {
      const partnerId = activePairs.get(socket.id);
      if (partnerId) {
        io.to(partnerId).emit("chat-message", {
          sender: "stranger",
          text
        });
      }
    });

    // Handle typing indicators
    socket.on("typing", ({ isTyping }: { isTyping: boolean }) => {
      const partnerId = activePairs.get(socket.id);
      if (partnerId) {
        io.to(partnerId).emit("typing", { isTyping });
      }
    });

    // Safe termination on socket disconnect
    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      cleanUpUser();
      
      // Update global engagement count for active searchers
      io.emit("stats-update", { count: io.engine.clientsCount });
    });
  });

  // Serve static assets in production or leverage Vite middleware in dev
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical server bootstrap error:", err);
});
