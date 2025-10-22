import db from "@/db";
import * as schema from "@/db/schema";
import { auth } from "@/lib/auth";
import { generateToken } from "@/lib/jwt";
import { userSchema } from "@/lib/validator";
import { and, eq, getTableColumns } from "drizzle-orm";

export async function POST(req: Request) {
    try {
        const rawData = await req.json();
        const { success, data, error } = userSchema.safeParse(rawData);

        if (!success)
            return Response.json(
                { message: "Validation failed", data: null, statusCode: 422 },
                { status: 422 }
            );

        const { token, deletedAt, updatedAt, createdAt, ...userSelectFields } = getTableColumns(schema.users);

        const [isUserExists] = await db
            .select(userSelectFields)
            .from(schema.users)
            .where(eq(schema.users.email, data.email));

        if (isUserExists?.isDeleted)
            return Response.json(
                { message: "Invalid account! Please try to login with other account.", data: null, statusCode: 400 },
                { status: 400 }
            );

        if (isUserExists) {
            const accessToken = generateToken(isUserExists);
            const refreshToken = generateToken(isUserExists);

            if (!isUserExists.fcmToken)
                await db.update(schema.users).set({ fcmToken: data.fcmToken }).where(eq(schema.users.id, isUserExists.id))

            await db.update(schema.users).set({ token: refreshToken }).where(eq(schema.users.id, isUserExists.id));

            return Response.json(
                { message: "Welcome to Chitra AI", data: { ...isUserExists, accessToken, refreshToken }, statusCode: 200 },
                { status: 200 }
            );
        }

        // Create new user with initial 5 free credits
        const [user] = await db.insert(schema.users).values({
            ...data,
            credits: 5  // Give 5 free credits on registration
        }).returning(userSelectFields);

        const accessToken = generateToken(user);
        const refreshToken = generateToken(user);

        await db.update(schema.users).set({ token: refreshToken }).where(eq(schema.users.id, user.id));

        // Record the initial free credits in credit_histories
        await db.insert(schema.creditHistories).values({
            userId: user.id,
            amount: 5,
            type: 'REGISTRATION_BONUS',
            createdAt: new Date()
        });

        console.log(`✅ New user registered: ${user.email} - 5 free credits added`);

        return Response.json(
            { message: "Welcome to Chitra AI", data: { ...user, accessToken, refreshToken }, statusCode: 200 },
            { status: 200 }
        );
    } catch (error) {
        console.log(error);
        return Response.json(
            { message: "Unable to process request at the moment.", data: null, statusCode: 400 },
            { status: 400 }
        );
    }
}

export async function DELETE(req: Request) {
    try {
        const authUser = await auth(req);

        if (!authUser)
            return Response.json({ message: 'Authentication required', data: null, statusCode: 401 }, { status: 401 });

        const [user] = await db.select().from(schema.users).where(and(eq(schema.users.id, authUser.id), eq(schema.users.isDeleted, false)))

        if (!user)
            return Response.json(
                { message: "User not found", data: null, statusCode: 404 },
                { status: 404 }
            );

        await db.update(schema.users).set({ fcmToken: null }).where(eq(schema.users.id, user.id))

        return Response.json(
            { message: "User logout successfully", data: null, statusCode: 200 },
            { status: 200 }
        );
    } catch (error) {
        console.log(error);
        return Response.json(
            { message: "Unable to process request at the moment.", data: null, statusCode: 400 },
            { status: 400 }
        );
    }
}