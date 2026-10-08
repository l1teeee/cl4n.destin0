import { testDatabaseUrl } from "../helpers/test-db";

process.env.DATABASE_URL = testDatabaseUrl().toString();
process.env.APP_ENV = "test";
process.env.EMAIL_MODE = "log";
process.env.APP_BASE_URL = "http://localhost:3000";
