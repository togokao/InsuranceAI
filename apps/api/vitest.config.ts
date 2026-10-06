import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 整合測試共用同一個資料庫，依序執行
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
  },
});
