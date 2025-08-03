"use client"
import { useTRPC } from '@/trpc/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import React from 'react'

const Client = () => {
    const trpc= useTRPC();
    const { data } = useSuspenseQuery(trpc.hello.queryOptions({ text: "codevibe" }));
  return (
    <div>{JSON.stringify(data)}</div>
  )
}

export default Client