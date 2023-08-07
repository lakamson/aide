import { useEffect, useRef, useState } from "react";
import {
  VSCodeButton,
  VSCodeTag,
  VSCodeTextArea,
  VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";

import { useCommitStore, usePageStore } from "../store";
import { GitCommitRequest } from "../types";
import { messageHandler } from "@estruyf/vscode/dist/client";

export const Commit = () => {
  const { setPage } = usePageStore();
  const { commitPrepData } = useCommitStore();
  const [summary, setSummary] = useState<string>("");

  const changeDescriptions = useRef(commitPrepData.changeDescriptions.flatMap((cd) => cd.changes));
  const [changeReasons, setChangeReasons] = useState<string[]>(
    Array(commitPrepData.changeDescriptions.flatMap((cd) => cd.changes).length).fill("")
  );

  useEffect(() => {
    changeDescriptions.current = commitPrepData.changeDescriptions.flatMap((cd) => cd.changes);
    setChangeReasons(
      Array(commitPrepData.changeDescriptions.flatMap((cd) => cd.changes).length).fill("")
    );
  }, [commitPrepData]);

  const handleSubmit = () => {
    const commitRequest: GitCommitRequest = {
      files: commitPrepData.changedFiles,
      message: changeDescriptions.current
        .map((change, index) => {
          return `${change}${changeReasons[index] !== "" ? `\n${changeReasons[index]}` : ""}`;
        })
        .join("\n\n"),
    };
    console.log("Commiting", commitRequest);
    messageHandler.send("gitCommit", commitRequest);
    setPage("home");
  };

  return (
    <div className="mx-3 mb-12 flex flex-col min-h-full text-vscode-sideBar-foreground">
      <p className="text-sm">Summary</p>
      {/* @ts-ignore */}
      <VSCodeTextField
        value={summary}
        onInput={(e) => setSummary((e.target as HTMLTextAreaElement).value)}
      />
      <p className="text-sm mt-4">Body</p>
      <div className="p-2 border border-vscode-foreground">
        {changeDescriptions.current.map((change, index) => (
          <div key={index}>
            {/* @ts-ignore */}
            <VSCodeTag>WHAT CHANGED</VSCodeTag>
            {/* <ContentEditable
              html={change}
              onChange={(e) => (changeDescriptions.current[index] = e.target.value)}
            /> */}
            <p>{change}</p>
            {/* @ts-ignore */}
            <VSCodeTag className="mt-4">WHY IT WAS CHANGED</VSCodeTag>
            {/* @ts-ignore */}
            <VSCodeTextArea
              className="w-full mt-2"
              placeholder="Describe why the change was made"
              value={changeReasons[index]}
              onInput={(e) => {
                const newChangeReasons = [...changeReasons];
                newChangeReasons[index] = (e.target as HTMLTextAreaElement).value;
                setChangeReasons(newChangeReasons);
              }}
            />
            {index !== changeDescriptions.current.length - 1 && (
              <hr className="border-dotted border-vscode-foreground my-2" />
            )}
          </div>
        ))}
      </div>
      {/* @ts-ignore */}
      <VSCodeButton className="mt-4" onClick={handleSubmit}>
        Commit
      </VSCodeButton>
    </div>
  );
};
