import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/productionAgent/index";
import ResTool from "@/socket/resTool";
import Memory from "@/utils/agent/memory";

async function verifyToken(rawToken: string): Promise<Boolean> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return false;
  const { value: tokenKey } = setting;
  if (!rawToken) return false;
  const token = rawToken.replace("Bearer ", "");
  try {
    jwt.verify(token, tokenKey as string);
    return true;
  } catch (err) {
    return false;
  }
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    if (!token || !(await verifyToken(token))) {
      console.log("[productionAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }
    let isolationKey = socket.handshake.auth.isolationKey;
    if (!isolationKey) {
      console.log("[productionAgent] 连接失败，缺少 isolationKey");
      socket.disconnect();
      return;
    }

    console.log("[productionAgent] 已连接:", socket.id);

    const resTool = new ResTool(socket, {
      projectId: socket.handshake.auth.projectId,
      scriptId: socket.handshake.auth.scriptId,
    });
    let abortController: AbortController | null = null;

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;
      const memory = new Memory("scriptAgent", isolationKey);

      const msg = resTool.newMessage("assistant", "视频策划");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
      };

      const textStream = await agent.decisionAI(ctx);

      let currentMsg = ctx.msg;
      let text = currentMsg.text();
      let currentContent = "";

      const persistCurrentMessage = async () => {
        if (!currentContent.trim()) return;
        await memory.add("assistant:decision", currentContent, {
          name: "视频策划",
          createTime: new Date(currentMsg.datetime).getTime(),
        });
        currentContent = "";
      };

      const syncCurrentMessage = async () => {
        if (ctx.msg === currentMsg) return;
        text.complete();
        currentMsg.complete();
        await persistCurrentMessage();
        currentMsg = ctx.msg;
        text = currentMsg.text();
      };

      try {
        for await (const chunk of textStream) {
          await syncCurrentMessage();
          text.append(chunk);
          currentContent += chunk;
        }
      } catch (err: any) {
        if (err.name !== "AbortError") throw err;
      } finally {
        await syncCurrentMessage();
        text.complete();
        currentMsg.complete();
        await persistCurrentMessage();
        if (abortController === currentController) {
          abortController = null;
        }
      }
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
};
