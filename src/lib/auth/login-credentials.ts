export interface LoginCredentials {
  email: string;
  password: string;
}

export function readLoginCredentials(formData: FormData): LoginCredentials {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");

  return {
    email: typeof emailValue === "string" ? emailValue.trim() : "",
    password: typeof passwordValue === "string" ? passwordValue : "",
  };
}
