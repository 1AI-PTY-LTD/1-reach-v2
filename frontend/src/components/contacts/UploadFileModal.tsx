import { useRef, useState } from "react";
import { Dialog } from "../../ui/dialog";
import { Heading } from "../../ui/heading";
import { Button } from "../../ui/button";
import { uploadContactsFile } from "../../api/contactsApi";
import Logger from "../../utils/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../../lib/ApiClientProvider";

export default function UploadFileModal({
    isOpen,
    setIsOpen,
}: {
    isOpen: boolean;
    setIsOpen: (value: boolean) => void;
}) {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const queryClient = useQueryClient();
    const client = useApiClient();

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        console.log("mhau", e.target.files);
        const file = e.target.files?.[0];

        if (file) {
            setSelectedFile(file);
        }
    }

    async function handleUpload() {
        setIsUploading(true);
        try {
            Logger.debug('Uploading file', {
                component: 'contactsApi.uploadContactsFile',
                data: { filename: selectedFile?.name },
            });

            if (selectedFile) {
                const result = await uploadContactsFile(client, selectedFile);
                Logger.debug('Upload result', {
                    component: 'contactsApi.uploadContactsFile',
                    data: { result },
                });
                setUploadResult(result);

                // Invalidate contacts query to refresh the table
                if (result.status === 'success') {
                    Logger.info('Invalidating contacts query after successful upload', {
                        component: 'UploadFileModal',
                    });
                    queryClient.invalidateQueries({ queryKey: ['contacts'] });
                }
            }
        } catch (error) {
            Logger.error('Upload failed', {
                component: 'contactsApi.uploadContactsFile',
                data: { error },
            });
        } finally {
            setIsUploading(false);
        }
    }

    function handleCloseModal() {
        setIsOpen(false);
        setSelectedFile(null);
        setUploadResult(null);
    }

    return (
        <Dialog
            open={isOpen}
            onClose={() => setIsOpen(false)}
        >
            {uploadResult ? (
                <div>
                    <Heading className="text-center mb-2">
                        Upload Complete
                    </Heading>
                    <div className="text-sm text-gray-600w-full text-center mb-2">
                        {uploadResult.message}
                    </div>
                    <div className="flex justify-end mt-4">
                        <Button onClick={handleCloseModal}>
                            Close
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex flex-col mb-4">
                        <Heading className="text-center mb-4">
                            Select file to upload
                        </Heading>
                        <div className="flex items-center gap-2">
                            <input
                                className="hidden"
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept=".csv"
                            />
                            <Button
                                outline
                                onClick={() => fileInputRef.current?.click()}
                                className="w-28"
                            >
                                Choose File
                            </Button>
                            <div className="text-sm text-gray-600 bg-purple-100 flex-1 text-center p-2 rounded-md shadow-md">
                                Selected File:{" "}
                                <span className="font-bold px-2">
                                    {selectedFile?.name}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            outline
                            onClick={handleCloseModal}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="emerald"
                            onClick={handleUpload}
                            disabled={isUploading || !selectedFile}
                        >
                            {isUploading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Uploading...
                                </>
                            ) : (
                                'Upload'
                            )}
                        </Button>
                    </div>
                </>
            )}
        </Dialog>
    );
}
