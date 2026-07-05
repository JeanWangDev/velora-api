import { promises as fs } from "fs";
import path from "path";
import { BadRequestError } from "@/errors/app-error";

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/** 证件图片上传目录（相对进程工作目录） */
export const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");
const KYC_DIR = path.join(UPLOAD_ROOT, "kyc");

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/s;

export class KycUploadService {
  /**
   * 保存 base64 DataURL 图片到本地磁盘，返回可公网访问的相对路径。
   * @returns 形如 /uploads/kyc/1-front-1730000000000.jpg
   */
  static async saveDataUrl(
    userId: number,
    side: "front" | "back",
    dataUrl: string,
  ): Promise<{ url: string }> {
    const match = DATA_URL_RE.exec(dataUrl.trim());
    if (!match) {
      throw new BadRequestError("图片格式无效");
    }

    const mime = match[1].toLowerCase();
    const ext = ALLOWED_MIME[mime];
    if (!ext) {
      throw new BadRequestError("仅支持 JPG / PNG / WEBP 图片");
    }

    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0) {
      throw new BadRequestError("图片内容为空");
    }
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestError("图片大小不能超过 5MB");
    }

    await fs.mkdir(KYC_DIR, { recursive: true });
    const filename = `${userId}-${side}-${Date.now()}.${ext}`;
    await fs.writeFile(path.join(KYC_DIR, filename), buffer);

    return { url: `/uploads/kyc/${filename}` };
  }
}
