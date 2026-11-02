import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db, id } from "@/lib/db";
const schema=z.object({body:z.string().trim().min(1).max(500),parentId:z.string().uuid().optional()});
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const {id:postId}=await params;const rows=await(await db()).query("SELECT c.id,c.body,c.parent_id,c.created_at,u.username,u.display_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=$1 ORDER BY c.created_at ASC",[postId]);return NextResponse.json({comments:rows.rows})}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const user=await currentUser();if(!user)return NextResponse.json({error:"Please sign in to reply."},{status:401});const data=schema.safeParse(await request.json());if(!data.success)return NextResponse.json({error:"Replies must be 1–500 characters."},{status:400});const {id:postId}=await params;const commentId=id();await(await db()).query("INSERT INTO comments(id,post_id,author_id,parent_id,body) VALUES($1,$2,$3,$4,$5)",[commentId,postId,user.id,data.data.parentId??null,data.data.body]);return NextResponse.json({id:commentId,body:data.data.body,parent_id:data.data.parentId??null,username:user.username,display_name:user.display_name,created_at:new Date()},{status:201})}
