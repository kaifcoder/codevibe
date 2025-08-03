"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

function Page() {
  const trpc = useTRPC();
  const invoke = useMutation(trpc.invoke.mutationOptions({
    onSuccess: () =>{
      toast.success("Function invoked successfully!");
    },
    onError: (error) => {
      toast.error(`Error invoking function: ${error.message}`);
    },
  }));

  // state for the input message
  const [message, setMessage] = useState("");

  
  
  return (
    
    <div className="p-4 flex flex-col mx-auto max-w-2xl">
      <p> AI Chat using Inngest backgroud jobs</p>
      {/* ADD INPUT */}
      <Input 
        placeholder="enter your message"
        className="mb-4"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <Button disabled={invoke.isPending} onClick={() => invoke.mutate({
        message: message
      })}>
        send message
      </Button>
    </div>
  )
}

export default Page   