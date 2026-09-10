import "server-only";

const errorCodes = [
  "ERR_REQUIRE_ASYNC_MODULE", "ERR_REQUIRE_ESM", "ERR_MODULE_NOT_FOUND",
  "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_DLOPEN_FAILED",
  "ENOENT", "EACCES", "EPERM", "ENOEXEC", "ENOSPC", "ENOMEM", "EAGAIN",
  "Z_DATA_ERROR", "ERR_PADDING_2",
] as const;
const libraries = [
  "libnss3.so", "libnssutil3.so", "libnspr4.so", "libatk-1.0.so.0",
  "libatk-bridge-2.0.so.0", "libcups.so.2", "libdrm.so.2", "libdbus-1.so.3",
  "libX11.so.6", "libxcb.so.1", "libxkbcommon.so.0", "libXcomposite.so.1",
  "libXdamage.so.1", "libXfixes.so.3", "libXrandr.so.2", "libgbm.so.1",
  "libasound.so.2", "libglib-2.0.so.0", "libgio-2.0.so.0", "libgobject-2.0.so.0",
  "libstdc++.so.6", "libc.so.6",
] as const;

/** Extract allowlisted technical facts, never copy messages, stack, args or env. */
export function browserFailureFacts(error: unknown) {
  const current = error instanceof Error ? error : null;
  const cause = current?.cause instanceof Error ? current.cause : null;
  const message = [current?.message, cause?.message].filter(Boolean).join("\n");
  const codes = [current, cause].map((item) =>
    item && "code" in item && typeof item.code === "string" ? item.code : null,
  );
  const errorCode = errorCodes.find((code) => codes.includes(code) || message.includes(code)) ?? null;
  const missingLibrary = /error while loading shared libraries|cannot open shared object file/i.test(message)
    ? libraries.find((library) => message.includes(library)) ?? null : null;
  const moduleHint = ["@sparticuz/chromium", "playwright-core", "playwright"].find((name) => message.includes(name)) ?? null;
  const signal = ["SIGKILL", "SIGSEGV", "SIGABRT", "SIGILL", "SIGTERM"].find((name) => message.includes(name)) ?? null;
  const exitMatch = message.match(/\bexitCode[=:]\s*(\d{1,3})\b/);
  const exitValue = exitMatch ? Number(exitMatch[1]) : null;
  const exitCode = exitValue !== null && exitValue <= 255 ? exitValue : null;

  let reason = "unclassified_browser_error";
  if (errorCode === "ERR_REQUIRE_ASYNC_MODULE" || /require\(\)[\s\S]*top-level await/i.test(message)) reason = "async_module_require";
  else if (errorCode === "ERR_REQUIRE_ESM") reason = "esm_require_incompatible";
  else if (errorCode === "ERR_PACKAGE_PATH_NOT_EXPORTED") reason = "package_export_missing";
  else if (errorCode === "ERR_MODULE_NOT_FOUND" || errorCode === "MODULE_NOT_FOUND" || /cannot find (?:module|package)/i.test(message)) reason = "module_not_found";
  else if (/error while loading shared libraries|cannot open shared object file/i.test(message)) reason = "shared_library_missing";
  else if (/GLIBC(?:XX)?_[\d.]+.*not found/i.test(message)) reason = "libc_version_incompatible";
  else if (/executable doesn't exist|input directory.*does not exist/i.test(message)) reason = "browser_files_missing";
  else if (errorCode === "ENOENT") reason = "file_not_found";
  else if (errorCode === "EACCES" || errorCode === "EPERM") reason = "permission_denied";
  else if (errorCode === "ENOEXEC" || /exec format error/i.test(message)) reason = "executable_format_incompatible";
  else if (errorCode === "ENOSPC") reason = "temporary_storage_full";
  else if (errorCode === "ENOMEM") reason = "memory_allocation_failed";
  else if (errorCode === "EAGAIN") reason = "process_resource_unavailable";
  else if (errorCode === "Z_DATA_ERROR" || /brotli|decompress/i.test(message)) reason = "binary_decompression_failed";
  else if (errorCode === "ERR_DLOPEN_FAILED") reason = "native_module_load_failed";
  else if (signal === "SIGKILL") reason = "process_killed"; // Not proof of OOM.
  else if (signal) reason = "process_terminated";
  else if (/timeout/i.test(message)) reason = "browser_start_timeout";
  else if (/target.*(?:browser|page).*closed|browser.*closed/i.test(message)) reason = "browser_closed_during_launch";

  return { reason, errorCode, missingLibrary, moduleHint, signal, exitCode };
}
