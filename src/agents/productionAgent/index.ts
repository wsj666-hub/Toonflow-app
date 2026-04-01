import { Socket } from "socket.io";
import { tool } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import { buildSkillPrompt, createSkillTools, parseFrontmatter, scanSkills, useSkill } from "@/utils/agent/skillsTools";
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
      { role: "assistant", content: mem },
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
    messages,
  }: {
    prompt: string;
    system: string;
    name: string;
    memoryKey: string;
    tools?: Record<string, any>;
    messages?: { role: "user" | "assistant" | "system"; content: string }[];
  }) {
    parentCtx.msg.complete();
    const subMsg = resTool.newMessage("assistant", name);
    const text = subMsg.text();
    let fullResponse = "";

    const { textStream } = await u.Ai.Text("scriptAgent").stream({
      system,
      messages: messages ?? [{ role: "user", content: prompt }],
      abortSignal,
      tools: { ...extraTools, ...useTools({ resTool, msg: subMsg }) },
    });

    try {
      for await (const chunk of textStream) {
        text.append(chunk);
        fullResponse += chunk;
      }
      text.complete();
      subMsg.complete();
    } catch (err: any) {
      text.complete();
      subMsg.stop();
      throw err;
    }

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
          "你必须使用如下XML格式写入工作区：\n```",
          "拍摄计划：<scriptPlan>内容</scriptPlan>",
          "分镜表：<storyboardTable>内容</storyboardTable>",
          "分镜面板：<storyboardItem videoDesc='视频描述' prompt=提示词内容 track='分组' duration='视频推荐时间' associateAssetsIds='[该分镜所需的资产ID列表]' />",
          "```",
        ].join("\n");
      // "剧本：<script>内容</script>",

      const projectInfo = await u.db("o_project").where("id", resTool.data.projectId).first();
      if (!projectInfo) throw new Error(`项目不存在，ID: ${resTool.data.projectId}`);
      const artSkills = await createArtSkills(projectInfo?.artStyle!);

      return runAgent({
        prompt,
        system: systemPrompt + addPrompt,
        name: "执行导演",
        memoryKey: "assistant:execution",
        messages: [
          { role: "assistant", content: artSkills.prompt },
          { role: "user", content: prompt },
        ],
        tools: { ...artSkills.tools },
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
        system: systemPrompt + "你必须使用如下XML格式写入工作区：\n<storySkeleton>故事骨架内容</storySkeleton>",
        name: "监制",
        memoryKey: "assistant:supervision",
      });
    },
  });

  return { run_sub_agent_execution, run_sub_agent_supervision };
}

async function createArtSkills(artName: string) {
  const workerPath = u.getPath(["skills", "art_prompts", artName, "driector_skills"]);
  const skillList = await scanSkills(workerPath + "/*.md");
  const mainSkills: { path: string; name: string; description: string }[] = [];
  for (const skillPath of skillList) {
    if (!fs.existsSync(skillPath)) throw new Error(`主技能文件不存在: ${skillPath}`);
    const content = await fs.promises.readFile(skillPath, "utf-8");
    const parsed = parseFrontmatter(content);
    mainSkills.push({ path: skillPath, ...parsed });
  }
  const res = {
    prompt: buildSkillPrompt(mainSkills),
    tools: createSkillTools(mainSkills, { mainSkill: mainSkills, secondarySkills: [], tertiarySkills: [] }, workerPath),
  };
  return res;
}
