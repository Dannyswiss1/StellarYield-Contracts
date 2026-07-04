import { Indexer } from "./indexer.js";
import { NotificationService } from "./notifications.js";

// Single shared Indexer instance for the application
export const indexer = new Indexer(new NotificationService());

export default indexer;
