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

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
    joinedAt: number; // For tracking the 5-second interest priority grace period
  }

  let searchingPool: Searcher[] = [];
  const activePairs = new Map<string, string>(); // socketId -> strangerSocketId

  // Helper: Verify if two searchers can pair up based on interests and timelines
  function areEligible(userA: Searcher, userB: Searcher): boolean {
    if (userA.socketId === userB.socketId) return false;
    if (userA.mode !== userB.mode) return false;

    // Check if they share at least one common interest
    const common = userA.interests.filter(i => userB.interests.includes(i));
    if (common.length > 0) {
      return true; // Match with common interest is allowed at any time!
    }

    // Otherwise, both must be ready for a random match (no interests, or elapsed >= 5000ms)
    const now = Date.now();
    const userAReady = userA.interests.length === 0 || (now - userA.joinedAt >= 5000);
    const userBReady = userB.interests.length === 0 || (now - userB.joinedAt >= 5000);

    return userAReady && userBReady;
  }

  // Find the single best eligible match for a user in the pool
  function findMatch(user: Searcher): Searcher | null {
    const candidates = searchingPool.filter(c => areEligible(user, c));
    if (candidates.length === 0) return null;

    // Prioritize common interest matching first!
    const commonInterestCandidates = candidates.filter(c => {
      const common = user.interests.filter(i => c.interests.includes(i));
      return common.length > 0;
    });

    if (commonInterestCandidates.length > 0) {
      let bestMatch = commonInterestCandidates[0];
      let maxIntersection = 0;
      for (const cand of commonInterestCandidates) {
        const common = user.interests.filter(i => cand.interests.includes(i));
        if (common.length > maxIntersection) {
          maxIntersection = common.length;
          bestMatch = cand;
        }
      }
      return bestMatch;
    }

    // Otherwise, pick the eligible candidate who has been waiting the longest (oldest joinedAt)
    const sorted = [...candidates].sort((a, b) => a.joinedAt - b.joinedAt);
    return sorted[0];
  }

  // Active matchmaking sweep
  function sweepMatchmaking() {
    let i = 0;
    while (i < searchingPool.length) {
      const user = searchingPool[i];
      const match = findMatch(user);
      if (match) {
        // Remove both from search pool
        searchingPool = searchingPool.filter(
          s => s.socketId !== user.socketId && s.socketId !== match.socketId
        );

        // Bind pairs
        activePairs.set(user.socketId, match.socketId);
        activePairs.set(match.socketId, user.socketId);

        const commonInterests = user.interests.filter(item =>
          match.interests.includes(item)
        );

        // Notify both parties
        user.socket.emit("paired", {
          peerId: match.socketId,
          initiator: true,
          commonInterests
        });

        match.socket.emit("paired", {
          peerId: user.socketId,
          initiator: false,
          commonInterests
        });

        console.log(`[Sweep Match] Paired ${user.socketId} with ${match.socketId} on ${user.mode} mode. Common interests: ${commonInterests}`);
        // Reset index to start after pool mutations
        i = 0;
      } else {
        i++;
      }
    }
  }

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
        socket,
        joinedAt: Date.now()
      };

      // Add to search pool
      searchingPool.push(userObject);
      socket.emit("searching", { interests: normalizedInterests });
      console.log(`[Search] Listed ${socket.id} in pool for ${mode}. interests: ${normalizedInterests}`);

      // Fallback timer: If no common-interest match completed within 5 seconds, run sweep which permits random fallback
      setTimeout(() => {
        const stillSearching = searchingPool.find(s => s.socketId === socket.id);
        if (stillSearching) {
          console.log(`[TimeoutFallback] 5s elapsed for ${socket.id}. Executing fallback sweep.`);
          sweepMatchmaking();
        }
      }, 5050);

      // Trigger matchmaking sweep immediately
      sweepMatchmaking();
    });

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
