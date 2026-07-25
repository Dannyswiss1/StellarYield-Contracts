import type { Request, Response, NextFunction } from "express";
import { UserService } from "../../services/user.js";
import { AppError, ErrorCode } from "../middleware/errors.js";
import { userServiceInstance } from "../../services/userSingleton.js";

const userService = new UserService();

export async function getUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.getUser(String(req.params["address"]));
    if (!user) {
      throw new AppError(ErrorCode.USER_NOT_FOUND, "User not found", 404);
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function getUserPortfolio(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const portfolio = await userService.getUserPortfolio(
      String(req.params["address"]),
    );
    res.json(portfolio);
  } catch (err) {
    next(err);
  }
}

export async function searchUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const search = String(req.query["search"] ?? "");
    const users = await userService.searchUsers(search);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

export async function streamUserPositions(req: Request, res: Response, next: NextFunction) {
  try {
    const address = String(req.params["address"]);
    
    // Verify user exists or has positions
    const portfolio = await userService.getUserPortfolio(address);

    // Set SSE headers
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Send initial portfolio data
    res.write(`data: ${JSON.stringify({ type: "initial", portfolio })}\n\n`);

    // Listen for position updates
    const unsubscribe = userServiceInstance.onPositionUpdate(address, (position) => {
      const event = {
        type: "position_updated",
        vaultContractId: position.vaultContractId,
        shares: position.shares,
        deposited: position.deposited,
      };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Clean up on client disconnect
    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  } catch (err) {
    next(err);
  }
}
