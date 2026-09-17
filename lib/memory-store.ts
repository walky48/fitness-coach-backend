// Anthropic'in native "memory" tool'unu (type: memory_20250818) client-side
// implemente ediyoruz. Claude bu tool'u çağırdığında bize view/create/
// str_replace/insert/delete/rename komutlarından biri gelir; dosyaları biz
// saklarız (burada: Upstash Redis, çünkü Vercel fonksiyonları stateless).
//
// Not: Bu tool beta'dan yeni çıktı, alan isimleri (insert_line/new_str gibi)
// gelecekte değişebilir. Test ederken gerçek tool_use.input çıktısını
// console.log ile bir kere kontrol et ve gerekirse `pick()` çağrılarını
// güncel dokümana göre ayarla:
// https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const HASH_KEY = "coach:memories";

function pick(input: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) {
    if (input[k] !== undefined) return input[k];
  }
  return undefined;
}

function assertSafePath(path: string) {
  if (!path || !path.startsWith("/memories")) {
    throw new Error(`Path /memories dizini içinde olmalı: ${path}`);
  }
  if (path.includes("..")) {
    throw new Error("Path traversal'a izin verilmiyor");
  }
}

async function view(path: string): Promise<string> {
  if (path === "/memories" || path === "/memories/") {
    const files = await redis.hkeys(HASH_KEY);
    if (files.length === 0) return "Dizin /memories boş.";
    return "Dizin /memories:\n" + files.map((f) => `- ${f}`).join("\n");
  }
  const content = await redis.hget<string>(HASH_KEY, path);
  if (content == null) return `Hata: dosya bulunamadı: ${path}`;
  return content
    .split("\n")
    .map((line, i) => `${i + 1}\t${line}`)
    .join("\n");
}

async function create(path: string, fileText: string): Promise<string> {
  assertSafePath(path);
  await redis.hset(HASH_KEY, { [path]: fileText });
  return `Dosya oluşturuldu: ${path}`;
}

async function strReplace(path: string, oldStr: string, newStr: string): Promise<string> {
  const content = await redis.hget<string>(HASH_KEY, path);
  if (content == null) return `Hata: dosya bulunamadı: ${path}`;
  const occurrences = content.split(oldStr).length - 1;
  if (occurrences !== 1) {
    return `Hata: old_str tam olarak bir kez eşleşmeli (bulunan: ${occurrences})`;
  }
  await redis.hset(HASH_KEY, { [path]: content.replace(oldStr, newStr) });
  return `Dosya güncellendi: ${path}`;
}

async function insert(path: string, lineNumber: number, text: string): Promise<string> {
  const content = await redis.hget<string>(HASH_KEY, path);
  if (content == null) return `Hata: dosya bulunamadı: ${path}`;
  const lines = content.split("\n");
  lines.splice(lineNumber, 0, text);
  await redis.hset(HASH_KEY, { [path]: lines.join("\n") });
  return `${path} dosyasına satır ${lineNumber} sonrasına eklendi`;
}

async function del(path: string): Promise<string> {
  await redis.hdel(HASH_KEY, path);
  return `Silindi: ${path}`;
}

async function rename(oldPath: string, newPath: string): Promise<string> {
  const content = await redis.hget<string>(HASH_KEY, oldPath);
  if (content == null) return `Hata: dosya bulunamadı: ${oldPath}`;
  assertSafePath(newPath);
  await redis.hset(HASH_KEY, { [newPath]: content });
  await redis.hdel(HASH_KEY, oldPath);
  return `${oldPath} -> ${newPath} olarak yeniden adlandırıldı`;
}

export async function handleMemoryCommand(input: Record<string, any>): Promise<string> {
  const command = input.command;
  try {
    switch (command) {
      case "view":
        return await view(input.path);
      case "create":
        return await create(input.path, pick(input, "file_text", "content"));
      case "str_replace":
        return await strReplace(input.path, input.old_str, input.new_str);
      case "insert":
        return await insert(
          input.path,
          pick(input, "insert_line", "line") ?? 0,
          pick(input, "new_str", "insert_text", "text")
        );
      case "delete":
        return await del(input.path);
      case "rename":
        return await rename(
          pick(input, "path", "old_path"),
          pick(input, "new_path")
        );
      default:
        return `Bilinmeyen memory komutu: ${command}`;
    }
  } catch (err: any) {
    return `Hata: ${err.message ?? String(err)}`;
  }
}
