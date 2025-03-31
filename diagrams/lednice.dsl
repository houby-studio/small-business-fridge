workspace "Lednice IT" "Interní systém pro sdílení občerstvení s kolegy." {

    !identifiers hierarchical

    model {
        group "Users" {
            c = person "Customer" "Purchases products and pays invoices."
            s = person "Supplier" "Supplies items to customers and invoices them."
            a = person "Administrator" "Manages users and product categories."
        }
        ss = softwareSystem "Lednice IT" {
            wa = container "Web Application" "Express.js with handlebars SSR serving all content"
            db = container "Database Schema" {
                tags "Database"
            }
        }
        gapi = softwareSystem "Graph API"
        enid = softwareSystem "Entra ID"
        post = softwareSystem "SMTP server"
        cc = softwareSystem "Call Center" {
            dakt = container "Daktela"
            bdda = container "Born Digital Digital Agent"
        }
        aims = softwareSystem "AIMS ESL Server"
        aoai = softwareSystem "Azure OpenAI"

        c -> ss.wa "Uses"
        s -> ss.wa "Uses"
        a -> ss.wa "Uses"

        c -> cc.dakt "Calls"

        ss.wa -> ss.db "Reads and writes to"
        ss.wa -> gapi "Reads user contact information via"
        ss.wa -> enid "Authenticates user via"
        ss.wa -> post "Sends e-mail via"
        ss.wa -> aims "Updates products"
        ss.wa -> aims "Links products to labels"
        ss.wa -> aoai "Calls LLM API"

        cc.dakt -> cc.bdda "Forwards to"
        cc.bdda -> ss.wa "Uses on behalf of user"
    }

    views {
        systemContext ss "DiagramSC1" {
            include *
            autolayout lr
        }

        container ss "DiagramCT1" {
            include *
            autolayout lr
        }

        container cc "DiagramCT2" {
            include *
            autolayout lr
        }

        styles {
            element "Element" {
                color white
            }
            element "Person" {
                background #116611
                shape person
            }
            element "Software System" {
                background #2D882D
            }
            element "Container" {
                background #0437F2
            }
            element "Database" {
                shape cylinder
            }
        }
    }
}