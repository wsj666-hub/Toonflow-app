import { Socket } from "socket.io";
import { tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { useSkill } from "@/utils/agent/skillsTools";
import useTools from "@/agents/productionAgent/tools";
import ResTool from "@/socket/resTool";
import * as fs from "fs";
import path from "path";

export interface AgentContext {
  socket: Socket;
  isolationKey: string;
  text: string;
  userMessageTime?: number;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
}

function buildMemPrompt(mem: Awaited<ReturnType<Memory["get"]>>): string {
  let memoryContext = "";
  if (mem.rag.length) {
    memoryContext += `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`;
  }
  if (mem.summaries.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`;
  }
  if (mem.shortTerm.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`;
  }
  return `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

export async function decisionAI(ctx: AgentContext) {
  const { isolationKey, text, abortSignal } = ctx;
  const memory = new Memory("productionAgent", isolationKey);
  await memory.add("user", text);

  // const { skillPaths } = await useSkill({ mainSkill: "production_agent_decision" });
  // const prompt = await fs.promises.readFile(skillPaths.mainSkill, "utf-8");

  const skill = path.join(u.getPath("skills"), "production_agent_decision.md");
  const prompt = await fs.promises.readFile(skill, "utf-8");

  const mem = buildMemPrompt(await memory.get(text));

  const { textStream } = await u.Ai.Text("productionAgent").stream({
    messages: [
      { role: "system", content: prompt },
      { role: "system", content: mem },
      { role: "user", content: text },
    ],
    abortSignal,
    tools: {
      ...memory.getTools(),
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
      ...createSubAgent(ctx),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:decision", completion.text);
    },
  });

  return textStream;
}

function createSubAgent(parentCtx: AgentContext) {
  const { resTool, abortSignal } = parentCtx;
  const memory = new Memory("productionAgent", parentCtx.isolationKey);
  async function runAgent({
    prompt,
    system,
    name,
    memoryKey,
    tools: extraTools,
  }: {
    prompt: string;
    system: string;
    name: string;
    memoryKey: string;
    tools?: Record<string, any>;
  }) {
    parentCtx.msg.complete();
    const subMsg = resTool.newMessage("assistant", name);
    const text = subMsg.text();
    let fullResponse = "";

    const { textStream } = await u.Ai.Text("scriptAgent").stream({
      system,
      messages: [{ role: "user", content: prompt }],
      abortSignal,
      tools: { ...extraTools, ...useTools({ resTool, msg: subMsg }) },
    });

    for await (const chunk of textStream) {
      text.append(chunk);
      fullResponse += chunk;
    }

    text.complete();
    subMsg.complete();

    if (fullResponse.trim()) {
      await memory.add(memoryKey, fullResponse, {
        name,
        createTime: new Date(subMsg.datetime).getTime(),
      });
    }

    parentCtx.msg = resTool.newMessage("assistant", "视频策划");
    return fullResponse;
  }

  const promptInput = z.object({
    prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
  });

  const run_sub_agent_execution = tool({
    description: "执行层子Agent，负责衍生资产、",
    inputSchema: promptInput,
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "production_agent_execution.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");
      const addPrompt =
        "\n" +
        [
          "你可以使用如下XML格式写入工作区：\n```",
          "剧本：<script>内容</script>",
          "拍摄计划：<scriptPlan>内容</scriptPlan>",
          "分镜表：<storyboardTable>内容</storyboardTable>",
          "```",
        ].join("\n");

      return runAgent({
        prompt,
        system: systemPrompt + addPrompt,
        name: "执行导演",
        memoryKey: "assistant:execution",
      });
    },
  });

  const run_sub_agent_supervision = tool({
    description: "监制层子Agent，负责审核执行结果",
    inputSchema: promptInput,
    execute: async ({ prompt }) => {
      const skill = path.join(u.getPath("skills"), "production_agent_supervision.md");
      const systemPrompt = await fs.promises.readFile(skill, "utf-8");
      return runAgent({
        prompt,
        system: systemPrompt + "你可以使用如下XML格式写入工作区：\n<storySkeleton>故事骨架内容</storySkeleton>",
        name: "监制",
        memoryKey: "assistant:supervision",
      });
    },
  });

  return { run_sub_agent_execution, run_sub_agent_supervision };
}

// //====================== 执行层 ======================

// export async function executionAI(ctx: AgentContext) {
//   const { text, abortSignal } = ctx;

//   const skill = await useSkill({
//     mainSkill: "production_agent_execution",
//     workspace: ["production_agent_skills/execution"],
//     attachedSkills: ["production_agent_skills/execution/driector_art_skills/chinese_sweet_romance/driector_skills"], //todo：后续可以改为动态加载
//   });

//   const subMsg = ctx.resTool.newMessage("assistant", "执行导演");

//   const { textStream } = await u.Ai.Text("productionAgent").stream({
//     system: skill.prompt,
//     messages: [{ role: "user", content: text }],
//     abortSignal,
//     tools: {
//       ...skill.tools,
//       ...useTools({ resTool: ctx.resTool, msg: subMsg }),
//     },
//   });

//   return { textStream, subMsg };
// }

// export async function supervisionAI(ctx: AgentContext) {
//   const { text, abortSignal } = ctx;

//   const skill = await useSkill({ mainSkill: "production_agent_supervision", workspace: ["production_agent_skills/supervision"] });
//   const subMsg = ctx.resTool.newMessage("assistant", "监制");

//   const { textStream } = await u.Ai.Text("productionAgent").stream({
//     system: skill.prompt,
//     messages: [{ role: "user", content: text }],
//     abortSignal,
//     tools: {
//       ...skill.tools,
//       ...useTools({
//         resTool: ctx.resTool,
//         msg: subMsg,
//       }),
//     },
//   });

//   return { textStream, subMsg };
// }

// //工具函数
// function runSubAgent(parentCtx: AgentContext) {
//   const memory = new Memory("productionAgent", parentCtx.isolationKey);
//   return tool({
//     description: "启动子Agent执行独立任务。可用子Agent:executionAI, decisionAI, supervisionAI",
//     inputSchema: z.object({
//       agent: z.enum(["executionAI", "supervisionAI"]).describe("子Agent名称"),
//       prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
//     }),
//     execute: async ({ agent, prompt }) => {
//       const fn = [executionAI, supervisionAI][subAgentList.indexOf(agent)];

//       // 先完成主Agent当前的消息
//       parentCtx.msg.complete();
//       // 子Agent用新消息回复
//       const { textStream: subTextStream, subMsg } = await fn({ ...parentCtx, text: prompt });
//       let text = subMsg.text();
//       let fullResponse = "";
//       for await (const chunk of subTextStream) {
//         text.append(chunk);
//         fullResponse += chunk;
//       }
//       text.complete();
//       subMsg.complete();
//       if (fullResponse.trim()) {
//         await memory.add(`assistant:${agent === "executionAI" ? "execution" : "supervision"}`, fullResponse, {
//           name: agent === "executionAI" ? "执行导演" : "监制",
//           createTime: new Date(subMsg.datetime).getTime(),
//         });
//       }

//       // 为主Agent后续输出创建新消息
//       parentCtx.msg = parentCtx.resTool.newMessage("assistant", "监制");

//       return fullResponse;
//     },
//   });
// }
